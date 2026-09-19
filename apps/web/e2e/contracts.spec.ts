import { expect, test } from "@playwright/test";
import { launchOptions, nativeClick, signIn } from "./support";

// S03, S07, S08 — R08, R10, R31 (ADR-0015). Runs against both real servers
// (see playwright.config.ts and e2e/api-server.sh) at desktop-1440 and
// phone-390, per the build brief. The seed's PRJ-031 («Αντικατάσταση
// οχημάτων ασθενοφόρων», Larnaca) is deliberately past the R31 10% warning
// (ΤΥ/2026 contract, apps/api/src/db/seed-data.ts) and its own project
// engineer is `engineer.larnaca@ecapital.test`, so this suite raises a real
// variation on it rather than one this spec invents on a contract that
// might not exist.

test.use({ launchOptions });

const BREAKPOINTS = ["desktop-1440", "phone-390"];

test.beforeEach(({}, testInfo) => {
  test.skip(!BREAKPOINTS.includes(testInfo.project.name), "this suite runs at desktop and phone only");
});

const PROJECT_TITLE = "Αντικατάσταση οχημάτων ασθενοφόρων";

/** «Δεσμεύσεις» — the CostBar's committed-value legend item — as a plain number. */
async function committedValue(page: import("@playwright/test").Page): Promise<number> {
  const text = await page.locator("li", { hasText: "Δεσμεύσεις" }).locator(".font-k-mono").textContent();
  return Number((text ?? "").replace(/[^\d]/g, ""));
}

/**
 * `Table`'s own `onRowOpen` fires only on `Enter` against the focused row
 * (double-click starts an inline edit instead — `Table.tsx`'s own header
 * comment). Every row carries a `tabIndex` (0 for the focused one, -1 for
 * the rest — programmatically focusable either way), so this focuses the
 * row directly rather than relying on a click's own focus side effect, then
 * sends the real key.
 */
async function openRow(page: import("@playwright/test").Page, rowText: string): Promise<void> {
  const row = page.locator("tr", { hasText: rowText });
  await row.evaluate((element) => (element as HTMLElement).focus());
  await page.keyboard.press("Enter");
}

test("engineer raises and submits a variation; a different unit is refused; admin approves it and current value rises; the raiser sees the decision disabled on it", async ({
  page,
}, testInfo) => {
  const description = `E2E τροποποίηση ${Date.now()}`;

  // --- S02/S03: engineer.larnaca opens the over-10% Larnaca contract -----
  await signIn(page, "engineer.larnaca@ecapital.test");
  await page.goto("/projects");
  // Both the phone card and the desktop table render in the DOM at once
  // (`Projects.tsx` toggles which one shows with `tablet:hidden`/`hidden
  // tablet:block`, not by leaving the other one out), so a name/text locator
  // alone resolves to two links at any breakpoint — `:visible` picks
  // whichever one the current viewport actually shows.
  await page.locator("a:visible", { hasText: PROJECT_TITLE }).click();
  await expect(page.getByRole("heading", { name: PROJECT_TITLE })).toBeVisible();

  // The «Συμβάσεις» card lists this project's one contract.
  const contractLink = page.getByRole("link", { name: /^ΤΥ\/2026\// });
  await expect(contractLink).toBeVisible();
  await contractLink.click();

  // --- S07: the warnings strip, R31 --------------------------------------
  await expect(page.getByText(/ξεπερνούν το όριο του 10%/)).toBeVisible();
  const beforeValue = await committedValue(page);
  const contractUrl = page.url();

  await page.screenshot({ path: `e2e/screenshots/s07-warnings-${testInfo.project.name}.png`, fullPage: true });

  // --- S08: raise and submit a variation ----------------------------------
  await nativeClick(page.getByRole("link", { name: "Τροποποιήσεις σύμβασης" }));
  await page.waitForURL(/\/variations$/);

  await nativeClick(page.getByRole("button", { name: "Προσθήκη" }));
  // Scoped to the sheet: `Table`'s own column chooser (still in the DOM
  // behind it) has a same-named checkbox for the «Περιγραφή» column.
  const newSheet = page.getByRole("dialog");
  await newSheet.getByLabel("Περιγραφή").fill(description);
  await newSheet.getByLabel("Αξία").fill("15000");
  await newSheet.getByLabel("Χρόνος (ημέρες)").fill("5");
  await nativeClick(newSheet.getByRole("button", { name: "Αποθήκευση" }));
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await expect(page.getByText(description, { exact: true })).toBeVisible();
  await openRow(page, description);
  await nativeClick(page.getByRole("dialog").getByRole("button", { name: "Υποβολή" }));
  const confirmDialog = page.locator("dialog", { hasText: "Υποβάλλετε την τροποποίηση για έγκριση;" });
  await expect(confirmDialog).toBeVisible();
  await nativeClick(confirmDialog.getByRole("button", { name: "Υποβολή" }));
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await page.screenshot({ path: `e2e/screenshots/s08-submitted-${testInfo.project.name}.png`, fullPage: true });

  // --- a different unit: NoPermission on the same contract ----------------
  await page.context().clearCookies();
  await signIn(page, "estates.nicosia@ecapital.test");
  await page.goto(contractUrl);
  await expect(page.getByRole("heading", { name: "Δεν έχετε πρόσβαση σε αυτή τη σελίδα." })).toBeVisible();

  // --- admin approves the submitted variation -----------------------------
  await page.context().clearCookies();
  await signIn(page, "admin@ecapital.test");
  await page.goto(contractUrl);
  await expect(await committedValue(page)).toBe(beforeValue);

  await nativeClick(page.getByRole("link", { name: "Τροποποιήσεις σύμβασης" }));
  await page.waitForURL(/\/variations$/);
  await openRow(page, description);

  // RULE (UI instructions §4): the decision panel shows exactly three facts.
  const decisionDialog = page.getByRole("dialog");
  await expect(decisionDialog.locator("dl > div")).toHaveCount(3);
  await nativeClick(decisionDialog.getByRole("button", { name: "Έγκριση" }));
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // The row now reads Εγκρίθηκε, not bold like a SUBMITTED inbox row.
  await expect(page.locator("tr", { hasText: description })).toContainText("Εγκρίθηκε");

  await page.goto(contractUrl);
  const afterValue = await committedValue(page);
  expect(afterValue - beforeValue).toBe(15_000);

  await page.screenshot({ path: `e2e/screenshots/s07-approved-${testInfo.project.name}.png`, fullPage: true });

  // --- the raiser sees the decision disabled on their own SUBMITTED row ---
  // RULE (R10, ADR-0015): reuse the seed's own SUBMITTED variation on this
  // same contract («Αναβάθμιση δαπέδων…», #4), also raised by
  // engineer.larnaca — the one this spec just approved is APPROVED now and
  // no longer shows decision controls at all.
  await page.context().clearCookies();
  await signIn(page, "engineer.larnaca@ecapital.test");
  await page.goto(`${contractUrl}/variations`);
  await openRow(page, "Αναβάθμιση δαπέδων");

  const ownDialog = page.getByRole("dialog");
  await expect(ownDialog.getByRole("button", { name: "Έγκριση" })).toBeDisabled();
  await expect(
    ownDialog.getByText(
      "Δεν εγκρίνετε τροποποίηση που καταγράψατε εσείς. Αναθέστε την απόφαση σε άλλο πρόσωπο με δικαίωμα έγκρισης.",
    ),
  ).toBeVisible();
});
