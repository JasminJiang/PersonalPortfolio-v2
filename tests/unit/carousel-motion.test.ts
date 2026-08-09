import { describe, expect, it } from "vitest";
import {
  accumulateWheelSteps,
  nextWheelMotionTarget,
  normalizeWheelDelta,
} from "../../src/components/carousel/carouselMotion";

describe("carousel wheel motion", () => {
  it("normalizes pixel, line, page, and horizontal-dominant wheel input", () => {
    expect(normalizeWheelDelta({
      deltaX: 0,
      deltaY: 24,
      deltaMode: 0,
      lineHeight: 18,
      pageHeight: 900,
    })).toBe(24);
    expect(normalizeWheelDelta({
      deltaX: 0,
      deltaY: 3,
      deltaMode: 1,
      lineHeight: 18,
      pageHeight: 900,
    })).toBe(54);
    expect(normalizeWheelDelta({
      deltaX: -1,
      deltaY: 0,
      deltaMode: 2,
      lineHeight: 18,
      pageHeight: 900,
    })).toBe(-900);
    expect(normalizeWheelDelta({
      deltaX: 40,
      deltaY: 12,
      deltaMode: 0,
      lineHeight: 18,
      pageHeight: 900,
    })).toBe(40);
  });

  it("drops a stale static-wheel remainder as soon as direction reverses", () => {
    expect(accumulateWheelSteps(240, -40, 96)).toEqual({
      steps: 0,
      remainder: -40,
    });
  });

  it("starts a reversal from the rendered rotation instead of the old target", () => {
    const result = nextWheelMotionTarget({
      current: 0,
      target: 0.2,
      delta: -40,
      step: 0.3,
      lastDirection: 1,
    });

    expect(result.direction).toBe(-1);
    expect(result.target).toBeCloseTo(-0.048);
  });

  it("caps target lead so a burst cannot queue multiple unseen projects", () => {
    const result = nextWheelMotionTarget({
      current: 0,
      target: 0.2,
      delta: 120,
      step: 0.3,
      lastDirection: 1,
    });

    expect(result.target).toBeCloseTo(0.24);
  });
});
