import { expect, test } from "@playwright/test";
import { launchOptions, nativeClick, signIn } from "./support";

// S02, S03 — R03, R04, R05, R06, R07. Runs at all three configured
// breakpoints (phone-390, tablet-1024, desktop-1440 — see playwright.config.ts).
// Screenshots land in e2e/screenshots (gitignored).

test.use({ launchOptions });

// The administrator sees all eleven units, which is what the 42 seeded
// projects are spread across (apps/api/src/db/seed-data.ts).
test.beforeEach(async ({ page }) => {
  await signIn(page, "admin@ecapital.test");
});

test("S02 project list filters by unit via the URL and opens a project into S03", async ({ page }, testInfo) => {
  await page.goto("/projects?unit=nicosia-general");
  await expect(page.getByRole("heading", { name: "Έργα" })).toBeVisible();

  // The filter chip for the unit shows up, reflecting the URL (UI
  // instructions §4 FilterBar: filter state round-trips through the URL).
  await expect(page.getByText("Μονάδα: Γενικό Νοσοκομείο Λευκωσίας")).toBeVisible();

  // RULE (UI instructions §2): no horizontal scroll on the page itself at
  // any of the three breakpoints — the table/cards may scroll inside their
  // own container, which does not add to document.scrollWidth.
  await expect(async () => {
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    expect(overflow).toBe(true);
  }).toPass({ timeout: 5000 });

  await page.screenshot({ path: `e2e/screenshots/s02-${testInfo.project.name}.png`, fullPage: true });

  // Open the first matching project — the table's title link on tablet and
  // desktop, the compact card on phone; both point at the same
  // `/projects/<id>` href (UI instructions §5 "Phone: rows become compact
  // cards"), so this works at every breakpoint without branching on it.
  // Waits for the row to actually exist first — the query is still in
  // flight for a moment after the heading and the filter chip (derived from
  // the URL alone) already render.
  const firstProjectLink = page.locator('a[href^="/projects/"]:visible').first();
  await firstProjectLink.waitFor({ state: "visible" });
  await firstProjectLink.click();
  // The seeded id is a database uuid, not a fixture-style "PRJ-001" (the
  // code column keeps that shape; the route segment is the row id).
  await page.waitForURL(/\/projects\/[^/?]+$/);

  // S03: the cost bar and the audit timeline both render.
  await expect(page.getByRole("img", { name: /Εγκεκριμένος προϋπολογισμός/ })).toBeVisible();
  await expect(page.getByText("δημιούργησε το έργο")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Ορόσημα" })).toBeVisible();

  await expect(async () => {
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    expect(overflow).toBe(true);
  }).toPass({ timeout: 5000 });

  await page.screenshot({ path: `e2e/screenshots/s03-${testInfo.project.name}.png`, fullPage: true });
});

test("S02 sorting a column updates the URL and re-renders the list", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "phone-390", "the dense table is hidden in favour of cards below tablet width");
  await page.goto("/projects");
  await expect(page.getByRole("heading", { name: "Έργα" })).toBeVisible();

  // A real Playwright click on this button has been observed to hang this
  // sandbox's Chromium/CDP input pipeline (see `nativeClick`'s comment).
  await nativeClick(page.getByRole("button", { name: /Κωδικός/ }));
  await page.waitForURL(/sort=code/);
  await expect(page.getByRole("heading", { name: "Έργα" })).toBeVisible();
});

test("S03 shows «Διαθέσιμο σε επόμενη οθόνη» on the disabled tabs", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-1440", "one breakpoint is enough for this tooltip check");
  // Seeded ids are database uuids, so this walks in through S02 rather than
  // guessing a fixture-style path.
  await page.goto("/projects");
  const firstProjectLink = page.locator('a[href^="/projects/"]:visible').first();
  await firstProjectLink.waitFor({ state: "visible" });
  await firstProjectLink.click();
  await page.waitForURL(/\/projects\/[^/?]+$/);

  await expect(page.getByRole("tab", { name: "Κόστος" })).toBeDisabled();
  await expect(page.getByRole("tab", { name: "Κόστος" })).toHaveAttribute("title", "Διαθέσιμο σε επόμενη οθόνη");
});

test("a project in IDEA phase shows «—» for commitments and spend in S02, and S03 says why", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name === "phone-390", "the dense table is hidden in favour of cards below tablet width");
  await page.goto("/projects?phase=IDEA");
  await expect(page.getByRole("heading", { name: "Έργα" })).toBeVisible();

  // PRJ-001 in the seed: IDEA phase, so its commitments and spend are
  // unknown until the SAP import (CAPEX-01 §7) — «—», never «€ 0». Its
  // planned finish is dated, so these are the only two dashes in the row.
  const row = page.locator("tbody tr", { hasText: "Ανακαίνιση χειρουργείων" });
  await row.waitFor({ state: "visible" });
  await expect(row.getByText("—")).toHaveCount(2);
  await expect(row.getByText("€ 0")).toHaveCount(0);

  await row.getByRole("link").first().click();
  await page.waitForURL(/\/projects\/[^/?]+$/);
  await expect(
    page.getByText("Δεσμεύσεις και δαπάνες θα εμφανιστούν μετά την εισαγωγή SAP."),
  ).toBeVisible();
});
