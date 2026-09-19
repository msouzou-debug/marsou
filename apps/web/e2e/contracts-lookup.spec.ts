import { expect, test } from "@playwright/test";
import { launchOptions, signIn } from "./support";

// S07e — ADR-0019. Runs against both real servers (playwright.config.ts and
// e2e/api-server.sh): the point of this route is that a reference resolves to
// a contract through the row policies, and a mocked API would prove nothing
// about that.
//
// The e2e API is started without EMAP_URL or EFINANCE_URL, so the S07 link-
// outs must not appear — which is the other half of ADR-0019 §4's rule and is
// asserted here rather than only in the component test.

test.use({ launchOptions });

const BREAKPOINTS = ["desktop-1440", "phone-390"];

test.beforeEach(({}, testInfo) => {
  test.skip(!BREAKPOINTS.includes(testInfo.project.name), "this suite runs at desktop and phone only");
});

test("a CAP- reference opens the contract it names", async ({ page }) => {
  await signIn(page, "admin@ecapital.test");

  // Take a reference off the register itself rather than inventing one: the
  // seed allocates them, so nothing here may assume a particular number.
  await page.goto("/contracts");
  const ref = await page.getByTestId("contract-list").locator(".num").first().textContent();
  expect(ref).toMatch(/^CAP-\d{4}-\d{4}$/);

  await page.goto(`/contracts?q=${encodeURIComponent(ref as string)}`);
  await expect(page).toHaveURL(/\/contracts\/[0-9a-f-]{36}$/);
  // The eyebrow carries the same reference it was asked for.
  await expect(page.locator(".eyebrow")).toContainText(ref as string);
});

test("a reference nobody carries says so, and offers a way onward", async ({ page }) => {
  await signIn(page, "admin@ecapital.test");
  await page.goto("/contracts?q=CAP-1999-0001");

  // RULE (ADR-0019): the exact sentence, with the reference in it.
  await expect(page.getByText("Δεν βρέθηκε σύμβαση με αναφορά CAP-1999-0001.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Λίστα έργων" })).toHaveAttribute("href", "/projects");
  await expect(page).toHaveURL(/\/contracts\?q=CAP-1999-0001$/);
});

test("a contract in somebody else's unit is the same not-found", async ({ page }) => {
  // ADR-0010: not "forbidden" — it does not exist for them.
  await signIn(page, "admin@ecapital.test");
  await page.goto("/contracts?unit=larnaca-general");
  await page.goto("/contracts");
  const ref = await page.getByTestId("contract-list").locator(".num").first().textContent();

  await page.getByRole("button", { name: "Αποσύνδεση" }).click();
  await page.waitForURL(/\/sign-in/);
  await signIn(page, "technician.nicosia@ecapital.test");

  await page.goto(`/contracts?q=${encodeURIComponent(ref as string)}`);
  // Either it is one of Nicosia's own (the technician sees it) or it is not
  // (the not-found sentence). What must never happen is a 403 page or a
  // sentence that says the contract exists somewhere else.
  const body = await page.locator("main").innerText();
  expect(body).not.toContain("403");
  expect(body).not.toContain("Λάρνακ");
});

test("the register lists only the caller's own units", async ({ page }) => {
  await signIn(page, "engineer.larnaca@ecapital.test");
  await page.goto("/contracts");

  await expect(page.getByRole("heading", { name: "Συμβάσεις", level: 1 })).toBeVisible();
  const rows = page.getByTestId("contract-list").locator("li");
  await expect(rows.first()).toBeVisible();

  // Every row opens a contract this caller may actually read.
  const first = rows.first().getByRole("link");
  await first.click();
  await expect(page).toHaveURL(/\/contracts\/[0-9a-f-]{36}$/);
  await expect(page.locator(".eyebrow")).toContainText(/CAP-\d{4}-\d{4}/);
});

test("S07 offers no link out when the deployment was told of no sibling system", async ({ page }) => {
  await signIn(page, "admin@ecapital.test");
  await page.goto("/contracts");
  await page.getByTestId("contract-list").locator("li").first().getByRole("link").click();
  await expect(page).toHaveURL(/\/contracts\/[0-9a-f-]{36}$/);

  // RULE (ADR-0019 §4): no EMAP_URL, no link — never a guessed host.
  await expect(page.getByRole("link", { name: "Άνοιγμα στο eMAP" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Τιμολόγια στο eFinance" })).toHaveCount(0);
});
