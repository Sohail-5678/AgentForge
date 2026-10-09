import { expect, test } from "@playwright/test";

test("mobile: no horizontal scroll and the nav drawer opens", async ({ page }) => {
  for (const path of ["/", "/overview", "/redteam"]) {
    await page.goto(path);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, path).toBeLessThanOrEqual(1);
  }
  await page.goto("/overview");
  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(page.getByRole("dialog", { name: "Navigation" })).toBeVisible();
  await page.getByRole("dialog", { name: "Navigation" }).getByRole("link", { name: "Runs" }).click();
  await expect(page).toHaveURL(/\/runs/);
});
