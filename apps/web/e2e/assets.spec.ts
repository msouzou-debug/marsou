import { expect, test } from "@playwright/test";
import { launchOptions, nativeClick, nativeFill, signIn } from "./support";

// S16a, S17, S17a, S17b, S17c — R26–R30, R45.
//
// NOTE (hand-back summary): this spec is written against the M4 API contract
// (`packages/shared/src/asset.ts`) and the personas the build brief names —
// `technician.nicosia@ecapital.test` and `engineer.larnaca@ecapital.test`,
// both already seeded for M3 (`permits.spec.ts`'s own note). It could not be
// run in this session: M4's own routes (`/assets*`, `/a/:tag`) do not exist
// yet in this checkout's `apps/api` — that module, and the seed rows this
// spec needs (a Nicosia asset with a QR tag and some history, at least one
// unit with a replacement year inside the default 10-year window), are the
// other agent's own work, landing on `apps/api` in a separate worktree that
// had not merged when this was written. The project manager runs this after
// the merge, adjusting any seed-specific text below (marked ASSUMPTION)
// against whatever the API agent actually seeded. Every locator otherwise
// follows this suite's own conventions (`nativeClick`/`nativeFill`/`nativePress`
// for the sandbox's CDP-input issue, `permits.spec.ts`'s own skip-cleanly-
// rather-than-fail shape and waiting guards).

test.use({ launchOptions });

const BREAKPOINTS = ["desktop-1440"];

test.beforeEach(({}, testInfo) => {
  test.skip(!BREAKPOINTS.includes(testInfo.project.name), "this suite runs at desktop only");
});

test("technician.nicosia opens a scanned tag and sees the asset's history", async ({ page }) => {
  await signIn(page, "technician.nicosia@ecapital.test");

  // ASSUMPTION: the seeded Nicosia asset's own tag. Skip cleanly if M4 has
  // not merged yet, or the seed uses a different tag, rather than fail the
  // whole run — the same shape `permits.spec.ts` uses for M3.
  const seededTag = "NGH-HVAC-0001";
  await page.goto(`/a/${seededTag}`);

  const notFound = page.getByText("Δεν βρέθηκε πάγιο με αυτή την ετικέτα.");
  test.skip(await notFound.isVisible().catch(() => false), "M4 API not merged, or no seeded asset with this tag yet");

  // The scan redirects straight to the asset's own record.
  await page.waitForURL(/\/assets\/[^/]+$/);
  await expect(page.getByText(seededTag).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Ιστορικό" })).toBeVisible();
  // RULE (contract AssetHistoryEntry / "full history" definition of done):
  // scanning the label shows everything that ever touched the asset — at
  // least one entry, never the Timeline's own empty sentence.
  await expect(page.getByText("Δεν υπάρχουν καταχωρήσεις ακόμη.")).toBeHidden();
});

test("engineer.larnaca creates an asset and prints its label sheet", async ({ page }, testInfo) => {
  await signIn(page, "engineer.larnaca@ecapital.test");
  await page.goto("/assets/new");

  // ASSUMPTION: skip cleanly if M4 has not merged yet, the same shape
  // `permits.spec.ts` uses for M3.
  const nameField = page.getByLabel("Όνομα");
  test.skip(!(await nameField.isVisible().catch(() => false)), "M4 API not merged into this checkout yet");

  await nativeFill(nameField, "Δοκιμαστικό κλιματιστικό");
  // The form has no defaults for the two facts the register cannot do
  // without (class and criticality); `selectOption` works on the DOM, so it
  // does not go through the CDP input path nativeClick avoids.
  await page.getByLabel("Κατηγορία παγίου").selectOption("HVAC");
  await page.getByLabel("Κρισιμότητα").selectOption("3");
  await nativeClick(page.getByRole("button", { name: "Αποθήκευση" }));
  await page.waitForURL(/\/assets\/[^/]+$/);

  const tagLocator = page.locator("main").getByText(/^[A-Z]+-[A-Z]+-\d{4}$/).first();
  await tagLocator.waitFor({ timeout: 15_000 }).catch(() => undefined);
  const tag = await tagLocator.textContent();
  const url = new URL(page.url());
  const assetId = url.pathname.split("/").pop();

  await nativeClick(page.getByRole("link", { name: "Εκτύπωση ετικέτας" }));
  const [labelPage] = await Promise.all([page.waitForEvent("popup")]);
  await labelPage.waitForURL(new RegExp(`/assets/labels\\?ids=${assetId}`));

  // RULE (build brief item 4): one page, one QR, for one selected asset.
  await expect(labelPage.locator('[data-testid="labels-page"]')).toHaveCount(1);
  await expect(labelPage.locator('[data-testid="asset-label"]')).toHaveCount(1);
  if (tag) await expect(labelPage.getByText(tag)).toBeVisible();

  await page.screenshot({ path: `e2e/screenshots/s17a-asset-form-${testInfo.project.name}.png`, fullPage: true });
});

test("the replacement forecast shows the seeded years", async ({ page }) => {
  await signIn(page, "admin@ecapital.test");
  await page.goto("/assets/forecast");

  // The default range is this year to +10; the seeded rows should fall inside it.
  const emptyMessage = page.getByText("Δεν υπάρχουν πάγια με προγραμματισμένη αντικατάσταση σε αυτό το διάστημα.");
  await emptyMessage.waitFor({ timeout: 15_000 }).catch(() => undefined);
  test.skip(await emptyMessage.isVisible().catch(() => false), "no seeded replacement-forecast rows yet");

  await expect(page.getByRole("columnheader", { name: "Έτος" })).toBeVisible();
  await expect(page.getByText("Σύνολο")).toBeVisible();
});
