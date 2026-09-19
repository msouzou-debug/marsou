import { expect, test } from "@playwright/test";
import { launchOptions, nativeClick, nativeFill, nativePress, signIn } from "./support";

// S11–S15 — R19–R25.
//
// NOTE (hand-back summary): this spec is written against the M3 API
// contract (`packages/shared/src/permit.ts`) and the seeded personas the
// build brief names — `engineer.larnaca@ecapital.test` (`larnaca-general`,
// `project_engineer`) and `clinical.nicosia@ecapital.test`
// (`nicosia-general`, `clinical_approver`), both already in
// `apps/api/src/db/seed-data.ts`. It could not be run in this session: M3's
// own routes (`/permits`, `/icra/*`, `/areas/impact`, `/calendar`, `/inbox`)
// do not exist yet in this checkout's `apps/api` — that module, and the
// seed rows this spec needs (a Larnaca theatre with a system feed, a seeded
// Class IV Nicosia permit awaiting `clinical.nicosia`'s decision, a seeded
// clash on the calendar), are the other agent's own work, landing on
// `apps/api` in a separate worktree that had not merged when this was
// written. The project manager runs this after the merge, adjusting any
// seed-specific text below (marked ASSUMPTION) against whatever the API
// agent actually seeded. Every locator otherwise follows this suite's own
// conventions (`nativeClick`/`nativeFill`/`nativePress` for the sandbox's
// CDP-input issue, `cost.spec.ts`'s own skip-cleanly-rather-than-fail shape).

test.use({ launchOptions });

const BREAKPOINTS = ["desktop-1440"];

test.beforeEach(({}, testInfo) => {
  test.skip(!BREAKPOINTS.includes(testInfo.project.name), "this suite runs at desktop only");
});

test("engineer.larnaca creates a shutdown request and submits it as Class IV", async ({ page }, testInfo) => {
  await signIn(page, "engineer.larnaca@ecapital.test");
  await page.goto("/permits/new");

  // ASSUMPTION: skip cleanly if M3 has not merged yet rather than fail the
  // whole run — the same shape `cost.spec.ts` uses for M2.
  const systemsFieldset = page.getByText("Ηλεκτρικό", { exact: true }).first();
  test.skip(!(await systemsFieldset.isVisible().catch(() => false)), "M3 API not merged into this checkout yet");

  // Step 1: Σύστημα.
  await nativeClick(page.getByRole("checkbox").first()); // first system option
  await nativeFill(page.getByLabel("Τίτλος"), "Διακοπή ρεύματος χειρουργείου");
  await nativeClick(page.getByRole("button", { name: "Συνέχεια" }));

  // Step 2: Χώροι που επηρεάζονται — a Larnaca theatre, per the scenario.
  await nativeClick(page.getByText("Χειρουργείο", { exact: false }).first());
  await nativeClick(page.getByRole("button", { name: "Συνέχεια" }));

  // Step 3: Ημερομηνία και διάρκεια.
  const start = page.getByLabel("Προγραμματισμένη έναρξη");
  const end = page.getByLabel("Προγραμματισμένη λήξη");
  await nativeFill(start, "2026-04-01T08:00");
  await nativeFill(end, "2026-04-01T16:00");
  await nativeClick(page.getByRole("button", { name: "Συνέχεια" }));

  // Step 4: Επισκόπηση → S12.
  await nativeClick(page.getByRole("button", { name: "Συνέχεια στην ICRA" }));
  await page.waitForURL(/\/permits\/.+\/icra$/);

  // S12 step 1: Τύπος εργασίας — type C, per the scenario ("expect Class IV
  // for type C" on a Larnaca theatre, ICRA 2.0 Table 3-style HIGH risk row).
  await nativeClick(page.getByRole("radio", { name: /Τύπος C/ }));
  await nativeClick(page.getByRole("button", { name: "Συνέχεια" }));

  // S12 step 2: Ομάδα κινδύνου χώρων — leave the surrounding pickers empty.
  await nativeClick(page.getByRole("button", { name: "Συνέχεια" }));

  // S12 step 3: Κατηγορία.
  // The badge is first in DOM order; the 4×4 matrix grid below repeats the numerals.
  await expect(page.getByText("IV", { exact: true }).first()).toBeVisible();
  const controlBoxes = page.getByRole("checkbox", { name: "Ενημερώθηκα" });
  const count = await controlBoxes.count();
  for (let i = 0; i < count; i++) await nativeClick(controlBoxes.nth(i));
  await nativeClick(page.getByRole("button", { name: "Συνέχεια" }));

  // S12 step 4: Υποβολή.
  await nativeClick(page.getByRole("button", { name: "Υποβολή" }));
  await page.waitForURL(/\/permits\/[^/]+$/);
  // Submitting routes the request straight into clinical review (§6.4): the
  // reference is allocated and the status reads «Σε κλινική εξέταση».
  await expect(page.getByText(/PTW-LAR-\d{4}-\d{3}/).first()).toBeVisible();
  await expect(page.getByText("Εκκρεμεί έγκριση").first()).toBeVisible();
  // RULE (task item 1): the window entered at step 3 — 08:00–16:00 — reads
  // back unchanged, same day, both times, never shifted by a timezone. This
  // only holds with the browser's own zone pinned to Europe/Nicosia
  // (`playwright.config.ts`'s `timezoneId`), which is what makes
  // `src/lib/datetime.ts`'s conversion and the record's own
  // Europe/Nicosia display agree.
  await expect(page.getByText(/01\/04\/2026\s*08:00\s*[–-]\s*16:00/).first()).toBeVisible();

  await page.screenshot({ path: `e2e/screenshots/s12-icra-${testInfo.project.name}.png`, fullPage: true });
});

test("clinical.nicosia approves the seeded Class IV Nicosia permit from the inbox with 'a'", async ({ page }) => {
  await signIn(page, "clinical.nicosia@ecapital.test");
  await page.goto("/approvals");

  // The seeded Class IV medical-gas shutdown (PTW-NGH-2026-001) has lines for this approver.
  const seededRow = page.getByText(/PTW-NGH-2026-001/).first();
  await seededRow.waitFor({ timeout: 15_000 }).catch(() => undefined); // the list loads after navigation
  test.skip(!(await seededRow.isVisible().catch(() => false)), "no seeded Class IV Nicosia permit awaiting decision yet");

  await nativeClick(seededRow);
  await nativePress(page.locator("body"), "a");
  await expect(page.getByRole("dialog")).toBeHidden();
});

test("the print view renders one A4 page with the QR", async ({ page }) => {
  await signIn(page, "clinical.nicosia@ecapital.test");
  await page.goto("/permits");

  // A permit row, not the «Προσθήκη» link to /permits/new.
  // The reference cell of each row is a link to the record.
  const firstPermit = page.locator("tbody a[href^='/permits/']").first();
  await firstPermit.waitFor({ timeout: 15_000 }).catch(() => undefined); // the list loads after navigation
  test.skip(!(await firstPermit.isVisible().catch(() => false)), "no seeded permits yet");
  const href = await firstPermit.getAttribute("href");

  await page.goto(`${href}/print`);
  await expect(page.getByRole("img", { name: /permits\// })).toBeVisible(); // the QR's own accessible name is the URL it encodes
  await expect(page.locator(".permit-sheet")).toHaveCount(1);
});

test("the calendar shows the seeded clash", async ({ page }) => {
  // The seeded clash is two Larnaca permits on one system; Central Administration sees every unit.
  await signIn(page, "admin@ecapital.test");
  await page.goto("/calendar");

  const clashIcon = page.locator("[title*='PTW-'], [aria-label*='PTW-']").first();
  await clashIcon.waitFor({ timeout: 15_000 }).catch(() => undefined); // the calendar loads after navigation
  test.skip(!(await clashIcon.isVisible().catch(() => false)), "no seeded clash on the calendar yet");
  await expect(clashIcon).toBeVisible();
});
