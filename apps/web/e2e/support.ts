import { expect, type Locator, type Page } from "@playwright/test";

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

/**
 * A native DOM `.click()`, dispatched through `page.evaluate` instead of
 * Playwright's CDP-simulated mouse click. Some real clicks hang this
 * sandbox's Chromium/CDP input pipeline indefinitely — the same class of
 * issue as the "?" key note on the S25 test in s01.spec.ts — reproduced in
 * isolation against a `Table` sort header button, unrelated to the app: the
 * identical click dispatched natively completes immediately and produces the
 * correct navigation. Use only where a real Playwright `.click()` has been
 * confirmed to hang; an ordinary `.click()` works everywhere else in this
 * suite (including the sign-in button above and the S02 row-open link).
 */
export async function nativeClick(locator: Locator): Promise<void> {
  await locator.waitFor({ state: "visible" });
  await locator.evaluate((element) => (element as HTMLElement).click());
}

/**
 * A native value set plus an `input` event, instead of Playwright's
 * CDP-driven `fill()`.
 *
 * Same sandbox problem `nativeClick` documents, in the other half of the
 * input pipeline: at phone-390 a `fill()` against a field inside the S24
 * user sheet hangs indefinitely on "waiting for element to be visible,
 * enabled and editable", while the identical value set natively completes at
 * once and React sees the change. The prototype setter is used rather than
 * `element.value = …` because React installs its own value tracker on the
 * node and would otherwise treat the assignment as a no-op and skip the
 * `onChange`.
 *
 * Use only where a real `fill()` has been confirmed to hang; `signIn` above
 * uses an ordinary one and works everywhere in this suite.
 */
export async function nativeFill(locator: Locator, value: string): Promise<void> {
  await locator.waitFor({ state: "attached" });
  await locator.evaluate((element, text) => {
    const input = element as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )?.set;
    setter?.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}
