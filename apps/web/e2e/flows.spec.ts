import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test.describe("demo script (SPEC §1.5)", () => {
  test("landing → dashboard", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /AgentForge — evaluate, red-team and optimize/ })).toBeAttached();
    await expect(page.getByText("Evaluate / Attack /")).toBeVisible();
    await page.getByRole("link", { name: /Open the live dashboard/ }).click();
    await expect(page).toHaveURL(/\/overview/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Overview");
  });

  test("overview shows both agents with intervals", async ({ page }) => {
    await page.goto("/overview");
    await expect(page.getByRole("link", { name: "ReturnPilot", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "DataPilot", exact: true })).toBeVisible();
    await expect(page.getByText(/95% \d+%–\d+% · n=\d+/).first()).toBeVisible();
  });

  test("run detail → case drawer → trace timeline", async ({ page }) => {
    await page.goto("/runs?trigger=nightly&agent=returnpilot");
    await page.locator("table tbody tr a").first().click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Run #");
    await page.getByRole("tab", { name: /failed/ }).click();
    const row = page.locator("table tbody tr").first();
    await row.click();
    const drawer = page.getByRole("dialog");
    await expect(drawer).toBeVisible();
    await expect(drawer.getByText("Graders")).toBeVisible();
    await expect(drawer.getByRole("list", { name: "Trace spans" }).or(drawer.getByText(/Trace not retained/))).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
  });

  test("red team heatmap filters the attack list", async ({ page }) => {
    await page.goto("/redteam");
    await expect(page.getByRole("heading", { name: "Attack success heatmap" })).toBeVisible();
    const cell = page.locator("button[aria-label*='attacks succeeded']").first();
    await cell.click();
    await expect(cell).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("heading", { name: "Attacks" })).toBeVisible();
  });

  test("optimizer: tree, pareto, gate card, promote is locked for visitors", async ({ page }) => {
    await page.goto("/optimizer");
    await page.locator("a[href^='/optimizer/']").first().click();
    await expect(page.getByRole("img", { name: "Optimizer candidate tree" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Pareto front" })).toBeVisible();
    const action = page.getByRole("button", { name: /Promote to active|Send to gate/ }).first();
    if (await action.count()) {
      await action.click();
      await expect(page.getByRole("dialog")).toContainText(/read-only demo snapshot/i);
    }
  });

  test("review queue lists drafted cases", async ({ page }) => {
    await page.goto("/datasets/review");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Review");
    await expect(page.locator("article").first()).toBeVisible();
  });

  test("API: healthz and trace explorer respond", async ({ request }) => {
    const h = await request.get("/api/v1/healthz");
    expect(h.ok()).toBe(true);
    expect((await h.json()).db.mode).toBe("snapshot");
    const t = await request.get("/api/v1/traces?limit=5");
    expect((await t.json()).items.length).toBeGreaterThan(0);
    const w = await request.post("/api/v1/traces", { data: { traces: [] } });
    expect(w.status()).toBe(422);
    const k = await request.post("/api/v1/runs", { data: { agent: "returnpilot", suites: ["returnpilot/scenario"] } });
    expect(k.status()).toBe(401);
  });
});

test.describe("accessibility (WCAG AA, axe)", () => {
  for (const path of ["/", "/overview", "/runs", "/redteam", "/optimizer", "/datasets", "/calibration"]) {
    test(`no serious violations on ${path}`, async ({ page }) => {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
      const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      expect(serious.map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`)).toEqual([]);
    });
  }
});
