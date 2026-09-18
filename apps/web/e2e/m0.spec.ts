import { expect, test } from "@playwright/test";
import { launchOptions, signIn } from "./support";

// M0 — R01, R02, R43. CAPEX-01 §14: "a user can log in and see their own
// unit's area tree and nothing else". Runs against both real servers — the
// Next app and the NestJS API on a freshly seeded PostgreSQL (see
// playwright.config.ts and e2e/api-server.sh) — because the claim under test
// is an access-control claim, and access control lives in the database's row
// policies (ADR-0010). A mocked API would prove nothing about it.
//
// Two breakpoints, per the M0 brief: desktop-1440 and phone-390. Screenshots
// land in e2e/screenshots (gitignored).

test.use({ launchOptions });

const BREAKPOINTS = ["desktop-1440", "phone-390"];

test.beforeEach(({}, testInfo) => {
  test.skip(!BREAKPOINTS.includes(testInfo.project.name), "M0 runs at desktop and phone only");
});

test("a signed-out visitor is sent to the sign-in screen", async ({ page }, testInfo) => {
  await page.goto("/");

  await expect(page).toHaveURL(/\/sign-in\?next=%2F$/);
  await expect(page.getByRole("heading", { name: "eCapital" })).toBeVisible();
  await expect(page.getByText("Τα έργα, τα πάγια και η συντήρηση του ΟΚΥπΥ")).toBeVisible();
  // RULE (UI instructions §6): no nav rail and no top bar here — nothing in
  // either is reachable before signing in.
  await expect(page.locator("header")).toHaveCount(0);
  await expect(page.getByLabel("Μονάδα")).toHaveCount(0);

  await page.screenshot({ path: `e2e/screenshots/m0-sign-in-${testInfo.project.name}.png`, fullPage: true });
});

test("the head of estates for Nicosia sees their own unit and its area tree", async ({ page }, testInfo) => {
  await signIn(page, "estates.nicosia@ecapital.test");

  // The top bar knows who is signed in, at both breakpoints.
  await expect(page.getByTitle("Λογαριασμός: Ανδρέας Παπαδόπουλος")).toBeVisible();
  await expect(page.getByRole("button", { name: "Αποσύνδεση" })).toBeVisible();

  // RULE (R01, ADR-0010): the switcher lists what GET /org-units returned for
  // this caller. One unit, not eleven.
  const switcher = page.getByLabel("Μονάδα");
  await expect(switcher.locator("option")).toHaveCount(1);
  await expect(switcher.locator("option")).toHaveText(["Γενικό Νοσοκομείο Λευκωσίας"]);

  await page.goto("/units/nicosia-general/areas");
  await expect(page.getByRole("heading", { name: "Γενικό Νοσοκομείο Λευκωσίας", level: 1 })).toBeVisible();

  const tree = page.getByTestId("area-tree");
  await expect(tree.locator("> li")).toHaveCount(1);
  await expect(tree.locator("> li > ul > li")).toHaveCount(2);
  await expect(tree.locator("> li > ul > li > ul > li")).toHaveCount(6);

  await expect(page.getByRole("heading", { name: "Κτίριο Α — Κεντρική Πτέρυγα" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Ισόγειο" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Πρώτος όροφος" })).toBeVisible();
  // Type, risk group and beds, all plain text on one line — no colour until M3.
  await expect(
    page.getByText("Μονάδα εντατικής θεραπείας · ομάδα κινδύνου: πολύ υψηλή · 8 κλίνες"),
  ).toBeVisible();
  await expect(page.getByText("Θάλαμος · ομάδα κινδύνου: υψηλή · 24 κλίνες")).toBeVisible();

  await page.screenshot({ path: `e2e/screenshots/m0-areas-${testInfo.project.name}.png`, fullPage: true });
});

test("a unit that is not yours is a refusal, not a tree", async ({ page }, testInfo) => {
  await signIn(page, "estates.nicosia@ecapital.test");
  await page.goto("/units/larnaca-general/areas");

  // RULE (ADR-0010): the API answers 404 for a unit outside the caller's
  // access, and the screen shows the same thing it would for a unit that does
  // not exist. Nothing here reveals that Larnaca General is a real hospital.
  await expect(page.getByRole("heading", { name: "Δεν έχετε πρόσβαση σε αυτή τη σελίδα." })).toBeVisible();
  await expect(
    page.getByText("Ζητήστε πρόσβαση από τον Προϊστάμενο Τεχνικών Υπηρεσιών της μονάδας."),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Επιστροφή στην αρχική" })).toBeVisible();
  await expect(page.getByTestId("area-tree")).toHaveCount(0);
  await expect(page.getByText("Γενικό Νοσοκομείο Λάρνακας")).toHaveCount(0);

  await page.screenshot({
    path: `e2e/screenshots/m0-no-permission-${testInfo.project.name}.png`,
    fullPage: true,
  });
});

test("a Central Administration account sees all eleven units", async ({ page }, testInfo) => {
  await signIn(page, "admin@ecapital.test");

  await expect(page.getByTitle("Λογαριασμός: Μαρία Κωνσταντίνου")).toBeVisible();
  await expect(page.getByLabel("Μονάδα").locator("option")).toHaveCount(11);

  await page.screenshot({ path: `e2e/screenshots/m0-admin-${testInfo.project.name}.png`, fullPage: true });
});

test("signing out puts the visitor back outside the gate", async ({ page }) => {
  await signIn(page, "estates.nicosia@ecapital.test");
  await page.getByRole("button", { name: "Αποσύνδεση" }).click();
  await page.waitForURL(/\/sign-in/);

  // And the cookie is gone: asking for a gated page starts the loop over
  // exactly once, at sign-in, rather than bouncing.
  await page.goto("/units/nicosia-general/areas");
  await expect(page).toHaveURL(/\/sign-in\?next=%2Funits%2Fnicosia-general%2Fareas$/);
});
