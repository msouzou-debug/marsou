import { expect, test } from "@playwright/test";
import { launchOptions, nativeClick, signIn } from "./support";

// S07b, S07c, S07d — R09, R12 (ADR-0017). Runs against both real servers
// (see playwright.config.ts and e2e/api-server.sh) at desktop-1440 and
// phone-390, per the build brief.
//
// PRJ-036 («Ανακαίνιση χειρουργείων», Larnaca) carries its own breached RFI
// (`seedRfiBreached`) and PRJ-042 («Ανακαίνιση Μονάδας Εντατικής Θεραπείας»,
// Larnaca, CLOSED) carries twelve handover defects, one per NHS ERIC band
// that matters here (`seedHandoverDefects`) — both read only, so the same
// two projects are safe to read from both breakpoint workers at once. The
// RFI-answer and instruction-to-variation steps each raise their own record
// first (a unique question / instruction text per run, the same reasoning
// `contracts.spec.ts`'s own variation description gets) rather than touching
// a seeded row shared by every worker, which two breakpoints answering or
// linking at once would race on.

test.use({ launchOptions });

const BREAKPOINTS = ["desktop-1440", "phone-390"];

test.beforeEach(({}, testInfo) => {
  test.skip(!BREAKPOINTS.includes(testInfo.project.name), "this suite runs at desktop and phone only");
});

/**
 * `Table`'s own `onRowOpen` fires only on `Enter` against the focused row
 * (`Table.tsx`'s own header comment, and `contracts.spec.ts`'s own `openRow`
 * helper, repeated here since each spec file is independent).
 */
async function openRow(page: import("@playwright/test").Page, rowText: string): Promise<void> {
  const row = page.locator("tr", { hasText: rowText });
  await row.evaluate((element) => (element as HTMLElement).focus());
  await page.keyboard.press("Enter");
}

async function openContract(page: import("@playwright/test").Page, projectTitle: string): Promise<void> {
  await page.goto("/projects");
  // Both the phone card and the desktop table render in the DOM at once
  // (`Projects.tsx`'s own `tablet:hidden`/`hidden tablet:block` split), so a
  // text locator alone resolves to two links at any breakpoint.
  await page.locator("a:visible", { hasText: projectTitle }).click();
  await expect(page.getByRole("heading", { name: projectTitle })).toBeVisible();
  const contractLink = page.getByRole("link", { name: /^ΤΥ\/2026\// });
  await expect(contractLink).toBeVisible();
  await contractLink.click();
}

test("engineer.larnaca: a breached RFI chip, answering a new RFI, a variation from a new cost-impact instruction, and a closed contract's defect bands", async ({
  page,
}, testInfo) => {
  await signIn(page, "engineer.larnaca@ecapital.test");

  // --- S07b: PRJ-036's own seeded RFI is already breached (read only) -----
  await openContract(page, "Ανακαίνιση χειρουργείων");
  await nativeClick(page.getByRole("tab", { name: "Αιτήματα διευκρίνισης", exact: false }));
  await page.waitForURL(/\/rfis$/);
  await expect(page.getByText("Εκπρόθεσμο").first()).toBeVisible();

  await page.screenshot({ path: `e2e/screenshots/s07b-breached-${testInfo.project.name}.png`, fullPage: true });

  // Raise a fresh RFI (unique per run) so answering it never races the other
  // breakpoint's worker against the same seeded row, then watch its chip
  // become the answered date instead of a live SlaChip — the clock stops
  // once it is answered (ADR-0017).
  const question = `E2E ερώτηση ${testInfo.project.name} ${Date.now()}`;
  await nativeClick(page.getByRole("button", { name: "Προσθήκη" }));
  const newRfiDialog = page.getByRole("dialog");
  await newRfiDialog.getByLabel("Ερώτηση").fill(question);
  await nativeClick(newRfiDialog.getByRole("button", { name: "Αποθήκευση" }));
  await expect(page.getByRole("dialog")).toHaveCount(0);

  const newRow = page.locator("tr", { hasText: question });
  await expect(newRow).toBeVisible();
  await expect(newRow).toContainText("Απομένουν"); // a live SlaChip, days left.

  await openRow(page, question);
  const rfiDialog = page.getByRole("dialog");
  await expect(rfiDialog).toBeVisible();
  const answer = "Ισχύει ο τύπος EI60 σύμφωνα με τη μελέτη πυροπροστασίας.";
  await rfiDialog.getByLabel("Απάντηση").fill(answer);
  await nativeClick(rfiDialog.getByRole("button", { name: "Αποθήκευση" }));
  await expect(rfiDialog.getByText(answer)).toBeVisible();
  await nativeClick(rfiDialog.getByRole("button", { name: "Κλείσιμο" }));

  const answeredRow = page.locator("tr", { hasText: question });
  await expect(answeredRow).not.toContainText("Απομένουν");
  await expect(answeredRow).not.toContainText("Εκπρόθεσμο");

  // --- S07c: a fresh cost-impact instruction becomes a DRAFT variation ----
  await openContract(page, "Αντικατάσταση ακτινολογικού εξοπλισμού");
  await nativeClick(page.getByRole("tab", { name: "Οδηγίες εργοταξίου", exact: false }));
  await page.waitForURL(/\/instructions$/);

  const instructionText = `E2E οδηγία ${testInfo.project.name} ${Date.now()}`;
  await nativeClick(page.getByRole("button", { name: "Προσθήκη" }));
  const newInstructionDialog = page.getByRole("dialog");
  await newInstructionDialog.getByLabel("Οδηγία").fill(instructionText);
  await newInstructionDialog.getByLabel("Έχει οικονομική επίπτωση").check();
  await nativeClick(newInstructionDialog.getByRole("button", { name: "Αποθήκευση" }));
  await expect(page.getByRole("dialog")).toHaveCount(0);

  const instructionRow = page.locator("tr", { hasText: instructionText });
  await expect(instructionRow).toBeVisible();
  await nativeClick(instructionRow.getByRole("button", { name: "Δημιουργία τροποποίησης" }));

  await page.waitForURL(/\/variations$/);
  // S08's own phone/desktop split (nit 2) renders the row as a card on
  // phone and as a `<tr>` from desktop upward — `Variations.tsx`'s
  // `tablet:hidden`/`hidden tablet:block` pair — so which one is the
  // *visible* one depends on the breakpoint.
  const newVariationRow =
    testInfo.project.name === "phone-390" ? page.locator("li", { hasText: instructionText }) : page.locator("tr", { hasText: instructionText });
  await expect(newVariationRow).toBeVisible();
  await expect(newVariationRow).toContainText("Προσχέδιο");

  await page.screenshot({ path: `e2e/screenshots/s07c-variation-created-${testInfo.project.name}.png`, fullPage: true });

  // --- S07d: PRJ-042 is CLOSED and shows all four NHS ERIC bands ---------
  await openContract(page, "Ανακαίνιση Μονάδας Εντατικής Θεραπείας");
  await nativeClick(page.getByRole("tab", { name: "Ελλείψεις", exact: false }));
  await page.waitForURL(/\/defects$/);
  for (const band of ["Υψηλή", "Σημαντική", "Μέτρια", "Χαμηλή"]) {
    await expect(page.getByText(band).first()).toBeVisible();
  }

  await page.screenshot({ path: `e2e/screenshots/s07d-defects-${testInfo.project.name}.png`, fullPage: true });
});

test("technician.nicosia: reads the RFI log of their own unit but sees no «Προσθήκη»", async ({ page }) => {
  await signIn(page, "technician.nicosia@ecapital.test");

  await openContract(page, "Αντικατάσταση ανελκυστήρων");
  await nativeClick(page.getByRole("tab", { name: "Αιτήματα διευκρίνισης", exact: false }));
  await page.waitForURL(/\/rfis$/);

  // RULE (ADR-0017): can_read_unit is unit membership, not role — a
  // technician reads their own unit's contract site log even though they
  // may not write it, so this is the RFI table itself, not NoPermission.
  await expect(page.getByRole("heading", { name: "Δεν έχετε πρόσβαση σε αυτή τη σελίδα." })).not.toBeVisible();
  await expect(page.getByRole("heading", { name: "Αιτήματα διευκρίνισης" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Προσθήκη" })).toHaveCount(0);
});
