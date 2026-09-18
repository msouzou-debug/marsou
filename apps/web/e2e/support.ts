import { expect, type Page } from "@playwright/test";

// The sandbox's preinstalled Chromium (/opt/pw-browsers, per the build
// instructions) is an older revision than the `@playwright/test` version in
// this repo's lockfile expects, so the default "chromium-headless-shell"
// lookup 404s on a revision folder that was never downloaded. Pointing at the
// preinstalled full Chromium binary directly — a standard Playwright override
// — sidesteps the revision check without running `playwright install`. It
// lives in the specs rather than in playwright.config.ts so the config stays
// true on a machine with a normal Playwright install.
export const launchOptions = {
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
};

/**
 * Signs in through S00, the way a person does: the token is set by a server
 * action into an httpOnly cookie (ADR-0013), so there is nothing to inject
 * from the test side and no API call to fake.
 */
export async function signIn(page: Page, email: string, next = "/"): Promise<void> {
  await page.goto(`/sign-in?next=${encodeURIComponent(next)}`);
  await page.getByLabel("Διεύθυνση ηλεκτρονικού ταχυδρομείου").fill(email);
  await page.getByRole("button", { name: "Σύνδεση", exact: true }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/sign-in"));
  await expect(page.locator("header")).toBeVisible();
}
