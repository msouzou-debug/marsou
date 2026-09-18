import { expect, test } from "@playwright/test";
import { launchOptions, signIn } from "./support";

// S01 — R03. Runs at all three configured breakpoints (phone-390,
// tablet-1024, desktop-1440 — see playwright.config.ts). Screenshots land
// in e2e/screenshots (gitignored).

// The Chromium override lives in e2e/support.ts; see the note there.
test.use({ launchOptions });

// S01 is behind the gate now (src/proxy.ts), so every case starts signed in.
// The administrator is the account that sees all eleven units, which is what
// the portfolio fixtures are built for.
test.beforeEach(async ({ page }) => {
  await signIn(page, "admin@ecapital.test");
});

test("S01 portfolio dashboard has no horizontal page overflow", async ({ page }, testInfo) => {
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

test("S25: \"?\" opens the help drawer with the S01 section, Escape closes it", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-1440", "one breakpoint is enough for this behaviour");
  await expect(page.getByRole("heading", { name: "Χαρτοφυλάκιο έργων" })).toBeVisible();

  // Real "?" (both the bare key name and the "Shift+Slash" combination) hangs
  // this sandbox's Chromium/CDP input pipeline indefinitely — reproduced in
  // isolation, unrelated to the app: `keyboard.press("a")`, digits, other
  // Shift-combinations and "Escape" all dispatch instantly, only Shift+"/"
  // does not. Dispatching the same "?" keydown the browser would have
  // produced, instead of asking Playwright to synthesize the OS-level key
  // combination, exercises the identical code path (HelpProvider's `window`
  // "keydown" listener; see its unit tests in HelpProvider.test.tsx for the
  // same assertion without this workaround) without hitting that hang.
  // Redispatched inside `toPass`, not just once, in case the very first
  // attempt lands before HelpProvider's effect has attached its listener.
  // The toggle only re-fires while the drawer is still closed, so a retry
  // never flips an already-open drawer back shut.
  const drawer = page.getByRole("complementary");
  await expect(async () => {
    if (await drawer.isVisible()) return;
    await page.evaluate(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "?", bubbles: true, cancelable: true }));
    });
    await expect(drawer).toBeVisible({ timeout: 500 });
  }).toPass({ timeout: 5000 });
  await expect(drawer.getByRole("heading", { name: "Χαρτοφυλάκιο έργων" })).toBeVisible();

  // Viewport-only, not `fullPage`: the drawer is `position: fixed` to the
  // viewport, so a full-page screenshot of this longer-than-viewport screen
  // would show the drawer only over the first screenful and the unit table
  // uncovered underneath it for the rest of the page's height.
  await page.screenshot({ path: "e2e/screenshots/s01-help-desktop-1440.png" });

  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
});
