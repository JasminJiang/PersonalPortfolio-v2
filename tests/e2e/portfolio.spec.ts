import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function expectNoHorizontalOverflow(page: Page) {
  const dimensions = await page.locator("body").evaluate((body) => ({
    clientWidth: body.clientWidth,
    scrollWidth: body.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
}

async function expectNoSeriousAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  const violations = results.violations.filter(({ impact }) => impact === "serious" || impact === "critical");
  expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
}

test("carousel supports buttons, keyboard, wheel, and route restoration", async ({ page, isMobile }) => {
  await page.goto("/");
  const carousel = page.getByRole("region", { name: "Interactive project carousel" });
  await expect(carousel).toHaveAttribute("data-state", "ready");
  const heading = carousel.getByRole("heading", { level: 1 });
  await expect(heading).toHaveText("Aeolian Resonance");

  await carousel.getByRole("button", { name: /Next project/ }).click();
  await expect(heading).toHaveText("Waterborne Urbanism");

  await carousel.focus();
  await carousel.press("ArrowRight");
  await expect(heading).toHaveText("Voltlab");

  if (!isMobile) {
    await carousel.hover();
    await page.mouse.wheel(0, 80);
    await expect(heading).toHaveText("Cyan Pavilion");
  }

  await carousel.press("Home");
  await carousel.getByRole("link", { name: "View project" }).click();
  await expect(page).toHaveURL(/\/projects\/aeolian-resonance\/$/);
  await page.getByRole("link", { name: "All projects" }).click();
  await expect(page).toHaveURL(/\/#aeolian-resonance$/);
  await expect(carousel).toHaveAttribute("data-state", "ready");
  await expect(heading).toHaveText("Aeolian Resonance");
});

test("pointer drag changes the active project", async ({ page, isMobile }) => {
  test.skip(isMobile, "Touch behavior is covered by the mobile swipe test");
  await page.goto("/");
  const carousel = page.getByRole("region", { name: "Interactive project carousel" });
  await expect(carousel).toHaveAttribute("data-state", "ready");
  const box = await carousel.boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.45);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.35, box.y + box.height * 0.45, { steps: 8 });
  await page.mouse.up();
  await expect(carousel.getByRole("heading", { level: 1 })).not.toHaveText("Aeolian Resonance");
});

test("mobile swipe changes the active project", async ({ page, isMobile }) => {
  test.skip(!isMobile, "This assertion requires a touch-enabled context");
  await page.goto("/");
  const carousel = page.getByRole("region", { name: "Interactive project carousel" });
  await expect(carousel).toHaveAttribute("data-state", "ready");
  const box = await carousel.boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;
  await page.touchscreen.tap(box.x + box.width * 0.75, box.y + box.height * 0.45);
  await carousel.dispatchEvent("pointerdown", { pointerId: 1, isPrimary: true, button: 0, clientX: box.x + box.width * 0.75, clientY: box.y + box.height * 0.45 });
  await carousel.dispatchEvent("pointermove", { pointerId: 1, isPrimary: true, button: 0, clientX: box.x + box.width * 0.25, clientY: box.y + box.height * 0.45 });
  await carousel.dispatchEvent("pointerup", { pointerId: 1, isPrimary: true, button: 0, clientX: box.x + box.width * 0.25, clientY: box.y + box.height * 0.45 });
  await expect(carousel.getByRole("heading", { level: 1 })).not.toHaveText("Aeolian Resonance");
});

test("static project index remains usable without WebGL", async ({ page }) => {
  await page.addInitScript(() => {
    HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
  });
  await page.goto("/");
  await expect(page.getByRole("region", { name: "Interactive project carousel" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Open Aeolian Resonance" })).toBeVisible();
});

for (const route of ["/", "/about/", "/projects/aeolian-resonance/", "/missing-page/"]) {
  test(`${route} has no serious accessibility issue or horizontal overflow`, async ({ page }) => {
    await page.goto(route);
    if (route === "/") {
      await expect(page.getByRole("region", { name: "Interactive project carousel" })).toHaveAttribute(
        "data-state",
        "ready",
      );
    }
    await expectNoHorizontalOverflow(page);
    await expectNoSeriousAxeViolations(page);
  });
}

test("failed media exposes the designed placeholder", async ({ page }) => {
  await page.route("https://assets.jasminjiang.com/**", (route) => route.abort("failed"));
  await page.goto("/projects/aeolian-resonance/");
  const hero = page.locator(".project-detail__hero .media-frame");
  await expect(hero).toHaveClass(/media-frame--error/);
  await expect(hero.getByText("Media unavailable")).toBeVisible();
});
