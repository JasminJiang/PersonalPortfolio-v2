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
    await expect(heading).toHaveText("Voltlab");
    await page.mouse.wheel(0, 80);
    await expect(heading).toHaveText("Cyan Pavilion");
  }

  await carousel.press("Home");
  await carousel.getByRole("link", { name: "View project" }).press("Enter");
  await expect(page).toHaveURL(/\/projects\/aeolian-resonance\/$/);
  await page.getByRole("link", { name: "All projects" }).click();
  await expect(page).toHaveURL(/\/#aeolian-resonance$/);
  await expect(carousel).toHaveAttribute("data-state", "ready");
  await expect(heading).toHaveText("Aeolian Resonance");
});

test("high-frequency wheel bursts cannot queue more than one project of motion", async ({ page, isMobile }) => {
  test.skip(isMobile, "Desktop wheel behavior is not used by the touch interface");
  await page.goto("/");
  const carousel = page.getByRole("region", { name: "Interactive project carousel" });
  await expect(carousel).toHaveAttribute("data-state", "ready");
  const heading = carousel.getByRole("heading", { level: 1 });
  await expect(heading).toHaveText("Aeolian Resonance");

  await carousel.evaluate((element) => {
    for (let index = 0; index < 12; index += 1) {
      element.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 80 }));
    }
  });

  await page.waitForTimeout(500);
  await expect(heading).toHaveText(/Aeolian Resonance|Waterborne Urbanism/);
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

test("reduced motion keeps automatic WebGL enhancement deferred", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const carousel = page.getByRole("region", { name: "Interactive project carousel" });
  await expect(carousel).toHaveAttribute("data-state", "ready");
  await page.waitForTimeout(1_500);
  await expect(carousel).toHaveAttribute("data-scene-state", "deferred");
});

test("every visible static project opens directly", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const carousel = page.getByRole("region", { name: "Interactive project carousel" });
  const visibleProject = carousel.getByRole("link", { name: "Open Waterborne Urbanism" });
  const box = await visibleProject.boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  expect(viewport).not.toBeNull();
  if (!box || !viewport) return;
  const visibleLeft = Math.max(0, box.x);
  const visibleRight = Math.min(viewport.width, box.x + box.width);
  await page.mouse.click((visibleLeft + visibleRight) / 2, box.y + box.height / 2);
  await expect(page).toHaveURL(/\/projects\/waterborne-urbanism\/$/);
});

test("canvas click fallback opens any visible project", async ({ page, isMobile }) => {
  test.skip(isMobile, "The mobile carousel exposes the centered panel; side-link coverage is tested separately");
  await page.goto("/");
  const carousel = page.getByRole("region", { name: "Interactive project carousel" });
  await expect(carousel.locator("canvas")).toHaveCount(1);
  const box = await carousel.boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;
  await page.mouse.click(box.x + box.width * 0.7, box.y + box.height * 0.55);
  await expect(page).toHaveURL(/\/projects\/waterborne-urbanism\/$/);
});

test("blank canvas keeps the default cursor", async ({ page }) => {
  await page.goto("/");
  const canvas = page.locator(".carousel-shell__canvas canvas");
  await expect(canvas).toHaveCSS("cursor", "default");
});

test("home interface type remains readable in a split-screen viewport", async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 900 });
  await page.goto("/");
  const carousel = page.getByRole("region", { name: "Interactive project carousel" });
  await expect(carousel).toHaveAttribute("data-state", "ready");

  const sizes = await page.evaluate(() => {
    const readSize = (selector: string) => {
      const element = document.querySelector(selector);
      if (!(element instanceof HTMLElement)) throw new Error(`Missing ${selector}`);
      return Number.parseFloat(getComputedStyle(element).fontSize);
    };

    return {
      filter: readSize(".carousel-shell__filters button"),
      count: readSize(".carousel-shell__filters button span:last-child"),
      about: readSize(".carousel-shell__about"),
      footer: readSize(".carousel-shell__footer"),
    };
  });

  expect(sizes.filter).toBeGreaterThanOrEqual(13);
  expect(sizes.count).toBeGreaterThanOrEqual(12);
  expect(sizes.about).toBeGreaterThanOrEqual(13);
  expect(sizes.footer).toBeGreaterThanOrEqual(13);
  await expectNoHorizontalOverflow(page);
});

test("route transitions announce the project and unmount the WebGL canvas", async ({ page }) => {
  await page.goto("/");
  const carousel = page.getByRole("region", { name: "Interactive project carousel" });
  await expect(carousel).toHaveAttribute("data-state", "ready");
  await carousel.getByRole("button", { name: /Next project/ }).click();
  await expect(carousel).toHaveAttribute("data-scene-state", "ready");
  await expect(carousel.locator("canvas")).toHaveCount(1);

  await carousel.getByRole("link", { name: "View project" }).press("Enter");
  await expect(page).toHaveURL(/\/projects\/waterborne-urbanism\/$/);
  await expect(page.locator("canvas")).toHaveCount(0);
  const announcer = page.locator(".astro-route-announcer");
  await expect(announcer).toHaveAttribute("aria-live", "assertive");
  await expect(announcer).toContainText("Waterborne Urbanism");
});

test("managed videos remain mutually exclusive and respect reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    HTMLMediaElement.prototype.pause = function pause() {
      const calls = Number(this.dataset.pauseCalls ?? "0");
      this.dataset.pauseCalls = String(calls + 1);
    };
    HTMLMediaElement.prototype.play = function play() {
      this.dispatchEvent(new Event("play"));
      return Promise.resolve();
    };
  });
  await page.goto("/projects/voltlab-uiux/");
  const videos = page.locator("[data-managed-video]");
  await expect(videos).toHaveCount(8);
  await page.waitForTimeout(500);
  expect(await videos.evaluateAll((items) => items.every((video) => video.dataset.loaded !== "true"))).toBe(true);

  const first = videos.nth(0);
  const second = videos.nth(1);
  const secondBefore = Number(await second.getAttribute("data-pause-calls") ?? "0");
  await first.evaluate((video) => (video as HTMLVideoElement).play());
  const secondAfter = Number(await second.getAttribute("data-pause-calls") ?? "0");
  expect(secondAfter).toBeGreaterThan(secondBefore);

  const firstBefore = Number(await first.getAttribute("data-pause-calls") ?? "0");
  await second.evaluate((video) => (video as HTMLVideoElement).play());
  const firstAfter = Number(await first.getAttribute("data-pause-calls") ?? "0");
  expect(firstAfter).toBeGreaterThan(firstBefore);
});

test("About remains scrollable and its closing signature is reachable", async ({ page }) => {
  await page.goto("/about/");
  const dimensions = await page.evaluate(() => ({
    viewportHeight: window.innerHeight,
    scrollHeight: document.documentElement.scrollHeight,
  }));
  expect(dimensions.scrollHeight).toBeGreaterThan(dimensions.viewportHeight);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect(page.locator(".about-layout__signature")).toBeInViewport();
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
