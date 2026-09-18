import { expect, test } from "@playwright/test";

// S01 — R03. Runs at all three configured breakpoints (phone-390,
// tablet-1024, desktop-1440 — see playwright.config.ts). Screenshots land
// in e2e/screenshots (gitignored).

// The sandbox's preinstalled Chromium (/opt/pw-browsers, per the build
// instructions) is an older revision than the `@playwright/test` version in
// this repo's lockfile expects, so the default "chromium-headless-shell"
// lookup 404s on a revision folder that was never downloaded. Pointing at
// the preinstalled full Chromium binary directly — a standard Playwright
// override — sidesteps the revision check without touching
// playwright.config.ts or running `playwright install`.
test.use({
  launchOptions: { executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" },
});

test("S01 portfolio dashboard has no horizontal page overflow", async ({ page }, testInfo) => {
  await page.goto("/");

  // KPI tiles are the first thing the query resolves into, but the eyebrow
  // caption alone renders in the loading skeleton too — wait for the "as of"
  // line instead, which only appears once real data has arrived.
  await expect(page.getByRole("heading", { name: "Χαρτοφυλάκιο έργων" })).toBeVisible();
  await expect(page.getByText(/Δεδομένα στις/)).toBeVisible();
  await expect(page.locator("p.eyebrow").filter({ hasText: "Εγκεκριμένος προϋπολογισμός" })).toBeVisible();

  // RULE (UI instructions §2): S01 fits every breakpoint with no horizontal
  // scroll on the page itself (the unit table may scroll inside its own
  // container on phone, which does not add to document.scrollWidth).
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  expect(overflow).toBe(true);

  await page.screenshot({
    path: `e2e/screenshots/s01-${testInfo.project.name}.png`,
    fullPage: true,
  });
});

test("S01 at 1024: the exception list is reachable without scrolling when grouping is off", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "tablet-1024", "only meaningful at the tablet breakpoint");

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Χαρτοφυλάκιο έργων" })).toBeVisible();

  // RULE (UI instructions §2, §5): at 1024×768 the KPI strip plus the table
  // must not push the "Χρειάζονται προσοχή" list below the first screenful —
  // grouping defaults off, so this is the screen's out-of-the-box shape.
  const heading = page.getByRole("heading", { name: "Χρειάζονται προσοχή" });
  await expect(heading).toBeVisible();
  const box = await heading.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.y).toBeLessThanOrEqual(768);
});
