import { expect, test } from "@playwright/test";
import { launchOptions, nativeClick, nativeFill, signIn } from "./support";

// S24 «Χρήστες» — R01, R02, R42 (ADR-0020). Runs against both real servers
// (playwright.config.ts and e2e/api-server.sh) at desktop-1440 and
// phone-390, per the build brief.
//
// Nothing here is mocked: the roles this spec grants are written through the
// row policies on `app_user_role` and read back by a second request, which is
// the only way to prove that per-user role administration actually works.

test.use({ launchOptions });

const BREAKPOINTS = ["desktop-1440", "phone-390"];

test.beforeEach(({}, testInfo) => {
  test.skip(!BREAKPOINTS.includes(testInfo.project.name), "this suite runs at desktop and phone only");
});

/**
 * `Table`'s `onRowOpen` fires on `Enter` against the focused row (a
 * double-click starts an inline edit instead — `Table.tsx`'s own header
 * comment), so this focuses the row and sends the real key, the same way
 * contracts.spec.ts does.
 */
async function openRow(page: import("@playwright/test").Page, rowText: string): Promise<void> {
  const row = page.locator("tr", { hasText: rowText });
  await row.first().evaluate((element) => (element as HTMLElement).focus());
  await page.keyboard.press("Enter");
}

test("an administrator pre-registers an account and gives it a role at Λάρνακα", async ({ page }, testInfo) => {
  // A username of this run's own, so repeated runs do not collide on
  // `errors.usernameTaken` (the account name is unique, case-insensitively).
  const username = `n.test.${testInfo.project.name.replace(/[^a-z0-9]/g, "")}.${Date.now()}`;

  await signIn(page, "admin@ecapital.test", "/admin/users");
  await expect(page.getByRole("heading", { name: "Χρήστες", exact: true })).toBeVisible();
  // The tab strip: Διαχείριση now has two of them and lands on this one.
  await expect(page.getByRole("link", { name: "Ανάδοχοι" })).toBeVisible();

  // `nativeClick` rather than a real click: this sandbox's Chromium hangs its
  // CDP input pipeline on some clicks (see `support.ts`), and at phone-390
  // every click in this spec is one of them.
  await nativeClick(page.getByRole("button", { name: "Προσθήκη" }));
  const sheet = page.getByRole("dialog", { name: "Νέος χρήστης" });
  await expect(sheet.getByText("Ο χρήστης θα συνδεθεί με τον λογαριασμό ΟΚΥπΥ του· τα δικαιώματα ισχύουν από την πρώτη σύνδεση.")).toBeVisible();

  // `nativeFill` for the same reason as `nativeClick` — see `support.ts`.
  await nativeFill(sheet.getByLabel("Λογαριασμός"), username);
  await nativeFill(sheet.getByLabel("Όνομα"), "Νίκη Τεστ");
  await nativeClick(sheet.getByRole("checkbox", { name: "Μηχανικός έργου" }));
  // RULE (CAPEX-01 §10, ADR-0020): the auditor is appointed from the server.
  await expect(sheet.getByRole("checkbox", { name: "Ελεγκτής" })).toBeDisabled();

  await sheet.getByRole("listbox", { name: "Μονάδες" }).selectOption(["larnaca-general"]);
  await nativeClick(sheet.getByRole("button", { name: "Αποθήκευση" }));

  await expect(page.getByRole("dialog", { name: "Νέος χρήστης" })).toBeHidden();

  const row = page.locator("tr", { hasText: username });
  await expect(row).toBeVisible();
  await expect(row).toContainText("Μηχανικός έργου");
  await expect(row).toContainText("LAR");
  // Never signed in.
  await expect(row).toContainText("—");
  await expect(row).toContainText("Ενεργός");
});

test("an administrator cannot take their own administrator role away", async ({ page }) => {
  await signIn(page, "admin@ecapital.test", "/admin/users");
  await openRow(page, "Μαρία Κωνσταντίνου");

  const sheet = page.getByRole("dialog", { name: "Επεξεργασία χρήστη" });
  await expect(sheet).toBeVisible();
  await nativeClick(sheet.getByRole("checkbox", { name: "Διαχειριστής" }));
  await nativeClick(sheet.getByRole("button", { name: "Αποθήκευση" }));

  // The API's own sentence, shown inline — not a toast and not a redirect.
  await expect(sheet.getByRole("alert")).toContainText(
    "Δεν αφαιρείτε τον δικό σας ρόλο διαχειριστή",
  );

  // And the role really is still there after a reload.
  await page.reload();
  await expect(page.locator("tr", { hasText: "Μαρία Κωνσταντίνου" })).toContainText("Διαχειριστής");
});

test("a head of estates gets NoPermission on Χρήστες", async ({ page }) => {
  await signIn(page, "estates.nicosia@ecapital.test", "/admin/users");
  await expect(
    page.getByRole("heading", { name: "Δεν έχετε πρόσβαση σε αυτή τη σελίδα." }),
  ).toBeVisible();
  await expect(
    page.getByText("Τους χρήστες και τους ρόλους τους τα διαχειρίζεται ο Διαχειριστής συστήματος."),
  ).toBeVisible();
  // The other tab is still theirs — the register they do keep.
  await nativeClick(page.getByRole("link", { name: "Ανάδοχοι" }));
  await expect(page.getByRole("heading", { name: "Ανάδοχοι", exact: true })).toBeVisible();
});
