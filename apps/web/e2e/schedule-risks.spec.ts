import { expect, test } from "@playwright/test";
import { launchOptions, nativeClick, signIn } from "./support";

// S05, S06 — R06, R07. Runs against both real servers (see
// playwright.config.ts and e2e/api-server.sh) at desktop-1440 and
// phone-390, per the build brief. Reuses the seed's own Larnaca project
// («Αντικατάσταση οχημάτων ασθενοφόρων», the same one `contracts.spec.ts`
// opens) so this suite exercises real seeded milestones and risks rather
// than data it would otherwise have to invent through the API first.

test.use({ launchOptions });

const BREAKPOINTS = ["desktop-1440", "phone-390"];

test.beforeEach(({}, testInfo) => {
  test.skip(!BREAKPOINTS.includes(testInfo.project.name), "this suite runs at desktop and phone only");
});

const PROJECT_TITLE = "Αντικατάσταση οχημάτων ασθενοφόρων";

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** ISO `YYYY-MM-DD` to the `DD/MM/YYYY` `formatDate` shows in the table. */
function isoToDisplay(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

test("engineer.larnaca edits a forecast date and sees the deviation update, then adds a risk and sees it in the matrix; an auditor gets no edit controls on either page", async ({
  page,
}, testInfo) => {
  // --- S02/S03: open the Larnaca project -----------------------------------
  await signIn(page, "engineer.larnaca@ecapital.test");
  await page.goto("/projects");
  await page.locator("a:visible", { hasText: PROJECT_TITLE }).click();
  await expect(page.getByRole("heading", { name: PROJECT_TITLE })).toBeVisible();
  const projectUrl = page.url();

  // --- S05: edit the first milestone's forecast date -----------------------
  // `ProjectTabs` renders each tab as an `<a role="tab">` — the explicit
  // ARIA role overrides the anchor's implicit "link" role.
  await nativeClick(page.getByRole("tab", { name: "Χρονοδιάγραμμα" }));
  await page.waitForURL(/\/schedule$/);

  const firstRow = page.locator("table tbody tr").first();
  const cells = firstRow.locator("td");
  const forecastCell = cells.nth(3);
  const forecastDisplayBefore = await forecastCell.innerText();
  const deviationBefore = await cells.nth(5).innerText();

  await forecastCell.dblclick();
  const input = page.getByRole("textbox");
  const currentForecast = await input.inputValue();
  // Every seeded milestone carries a forecast date (`seed-projects.ts`'s
  // `milestonesFor`), so there is always a real ISO date here to move.
  const newForecast = addDays(currentForecast, 45);
  await input.fill(newForecast);
  await input.press("Enter");

  // The PATCH lands, the query refetches, and both the forecast cell and the
  // deviation cell — forecast minus baseline — read differently once it does.
  await expect(forecastCell).toHaveText(isoToDisplay(newForecast));
  await expect(forecastCell).not.toHaveText(forecastDisplayBefore);
  await expect(cells.nth(5)).not.toHaveText(deviationBefore);

  await page.screenshot({ path: `e2e/screenshots/s05-forecast-edited-${testInfo.project.name}.png`, fullPage: true });

  // --- S06: add a risk and see it in the matrix ----------------------------
  await page.goto(`${projectUrl}/risks`);
  const cellBefore = await page.getByRole("img", { name: /^Πιθανότητα 5, επίπτωση 5:/ }).getAttribute("aria-label");

  await nativeClick(page.getByRole("button", { name: "Προσθήκη" }).first());
  const riskDialog = page.getByRole("dialog");
  const description = `E2E κίνδυνος ${Date.now()}`;
  await riskDialog.getByLabel("Περιγραφή κινδύνου").fill(description);
  await riskDialog.getByLabel("Πιθανότητα (1–5)").selectOption("5");
  await riskDialog.getByLabel("Επίπτωση (1–5)").selectOption("5");
  await nativeClick(riskDialog.getByRole("button", { name: "Αποθήκευση" }));
  await expect(page.getByRole("dialog")).toHaveCount(0);

  const cellAfter = page.getByRole("img", { name: /^Πιθανότητα 5, επίπτωση 5:/ });
  await expect(cellAfter).not.toHaveAttribute("aria-label", cellBefore ?? "");
  await expect(cellAfter).not.toHaveAttribute("aria-label", /0 κίνδυνοι/);

  await page.screenshot({ path: `e2e/screenshots/s06-risk-added-${testInfo.project.name}.png`, fullPage: true });

  // --- auditor: no edit controls on either page ----------------------------
  await page.context().clearCookies();
  await signIn(page, "auditor@ecapital.test");

  await page.goto(`${projectUrl}/schedule`);
  await expect(page.getByRole("heading", { name: "Χρονοδιάγραμμα" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Προσθήκη" })).toHaveCount(0);

  await page.goto(`${projectUrl}/risks`);
  await expect(page.getByRole("button", { name: "Προσθήκη" })).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
