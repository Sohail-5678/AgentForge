import { expect, test } from "@playwright/test";

test("mobile: no horizontal scroll and the nav drawer opens", async ({ page }) => {
  for (const path of ["/", "/overview", "/redteam"]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    const r = await page.evaluate(() => {
      const vw = document.documentElement.clientWidth;
      const leaves = [...document.querySelectorAll("body *")]
        .filter((e) => e.getBoundingClientRect().right > vw + 1 && !e.closest(".overflow-x-auto, .marquee, [aria-hidden=true]"))
        .filter((e) => ![...e.children].some((ch) => ch.getBoundingClientRect().right > vw + 1))
        .slice(0, 5)
        .map((e) => `${e.tagName}.${String((e as HTMLElement).className).slice(0, 60)} “${(e.textContent || "").trim().slice(0, 30)}”`);
      return { overflow: document.documentElement.scrollWidth - vw, leaves };
    });
    expect(r.overflow, `${path} overflows by ${r.overflow}px: ${r.leaves.join(" | ")}`).toBeLessThanOrEqual(1);
  }
  await page.goto("/overview");
  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(page.getByRole("dialog", { name: "Navigation" })).toBeVisible();
  await page.getByRole("dialog", { name: "Navigation" }).getByRole("link", { name: "Runs", exact: true }).click();
  await expect(page).toHaveURL(/\/runs/);
});
