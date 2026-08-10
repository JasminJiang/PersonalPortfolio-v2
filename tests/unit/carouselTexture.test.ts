import { describe, expect, it } from "vitest";
import { coverTextureCrop } from "../../src/components/carousel/carouselTexture";

describe("coverTextureCrop", () => {
  it("center-crops portrait images vertically without changing their proportions", () => {
    const crop = coverTextureCrop(7084, 9445, 16, 9);

    expect(crop.repeatX).toBe(1);
    expect(crop.offsetX).toBe(0);
    expect(crop.repeatY).toBeCloseTo((7084 / 9445) / (16 / 9));
    expect(crop.offsetY).toBeCloseTo((1 - crop.repeatY) / 2);
  });

  it("center-crops panoramic images horizontally without changing their proportions", () => {
    const crop = coverTextureCrop(2400, 1000, 16, 9);

    expect(crop.repeatY).toBe(1);
    expect(crop.offsetY).toBe(0);
    expect(crop.repeatX).toBeCloseTo((16 / 9) / 2.4);
    expect(crop.offsetX).toBeCloseTo((1 - crop.repeatX) / 2);
  });

  it("leaves matching aspect ratios uncropped", () => {
    expect(coverTextureCrop(1600, 900, 16, 9)).toEqual({
      offsetX: 0,
      offsetY: 0,
      repeatX: 1,
      repeatY: 1,
    });
  });
});
