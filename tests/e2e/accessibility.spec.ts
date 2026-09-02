import { AxeBuilder } from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("the seeded Stage 1 editor has no detectable WCAG A/AA violations", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await expect(page.getByRole("region", { name: /Explorations infinite canvas/ })).toBeVisible();

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  await testInfo.attach("axe-results", {
    body: JSON.stringify(results, null, 2),
    contentType: "application/json",
  });

  expect(results.violations).toEqual([]);
});
