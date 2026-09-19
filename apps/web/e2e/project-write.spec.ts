import { expect, type Locator, type Page, test } from "@playwright/test";
import { launchOptions, nativeClick, signIn } from "./support";

// S02a, S03 — R04, R05. Runs against both real servers (see
// playwright.config.ts and e2e/api-server.sh) at desktop-1440 only: the
// three write flows this build adds (create, edit, phase change) do not
// change shape across breakpoints the way S02's table/cards split does, and
// S02/S03's own suites already cover phone/tablet layout for the read side
// of these same two screens.

test.use({ launchOptions });

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-1440", "one breakpoint is enough for these write flows");
});

// FactsList's Φάση row, scoped so a leftover (closed) PhaseDialog's own
// "current → next phase" text — the dialog is never unmounted, only closed,
// so its old text stays in the DOM — can never be confused with the fact.
function phaseFact(page: Page): Locator {
  return page.locator("dt", { hasText: "Φάση" }).locator("xpath=following-sibling::dd[1]");
}

test("estates.nicosia creates a project, changes its phase, and an auditor sees no phase control on it", async ({ page }) => {
  await signIn(page, "estates.nicosia@ecapital.test");

  // --- S02a: create -------------------------------------------------
  await page.goto("/projects");
  // A real Playwright click has been observed to hang this sandbox's
  // Chromium/CDP input pipeline for this button (see `nativeClick`'s own
  // comment in support.ts); the native dispatch it uses completes
  // immediately and produces the correct navigation.
  await nativeClick(page.getByRole("link", { name: "Προσθήκη" }));
  await page.waitForURL("/projects/new");

  // estates.nicosia only ever sees Nicosia General (the seed's
  // `orgUnitIds`), so the Μονάδα field is hidden (R01) — nothing to pick.
  const title = `E2E ${Date.now()}`;
  await page.getByLabel("Τίτλος", { exact: true }).fill(title);
  await page.getByLabel("Εγκεκριμένος προϋπολογισμός").fill("50000");

  await nativeClick(page.getByRole("button", { name: "Αποθήκευση" }));

  // --- S03: the new project, with a fresh NGH-2026- code -------------
  await page.waitForURL(/\/projects\/[^/?]+$/);
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  // Scoped to the page eyebrow (`${code} · ${unit}`) rather than a bare
  // text search — the audit timeline's own "created" entry also names the
  // code, in its detail line (`project-rows.ts`'s `toAuditEntry`).
  await expect(page.locator("p.eyebrow")).toContainText(/NGH-2026-\d+/);
  await expect(phaseFact(page)).toContainText("Ιδέα"); // IDEA, the phase every new project opens in (ADR-0014)

  // --- S03: change phase IDEA → PREPARATION with a reason ------------
  await nativeClick(page.getByRole("button", { name: "Αλλαγή φάσης" }));
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Ιδέα → Προετοιμασία");
  await page.getByLabel("Αιτιολογία").fill("Η μελέτη σκοπιμότητας ολοκληρώθηκε και εγκρίθηκε από τις Τεχνικές Υπηρεσίες.");
  await nativeClick(dialog.getByRole("button", { name: "Υποβολή" }));

  // The dialog closes and the refreshed detail shows the new phase.
  await expect(dialog).toBeHidden();
  await expect(phaseFact(page)).toContainText("Προετοιμασία");

  // The timeline's newest entry (it sorts newest-first — `Timeline`'s own
  // header comment) says the phase changed.
  const newestEntry = page.locator("ul li").first();
  await expect(newestEntry).toContainText("άλλαξε τη φάση του έργου");

  const projectUrl = page.url();

  // --- S03 again, as the auditor: no «Αλλαγή φάσης» -------------------
  await page.context().clearCookies();
  await signIn(page, "auditor@ecapital.test");
  await page.goto(projectUrl);
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  await expect(page.getByRole("button", { name: "Αλλαγή φάσης" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Επεξεργασία" })).toHaveCount(0);
});
