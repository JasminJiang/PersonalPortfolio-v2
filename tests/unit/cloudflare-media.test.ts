import { describe, expect, it } from "vitest";
import {
  CLOUDFLARE_IMAGE_QUALITY,
  PUBLIC_ASSET_ORIGIN,
  cloudflareImageSrcSet,
  cloudflareImageUrl,
  defaultResponsiveImageWidth,
  publicAssetUrl,
  responsiveWidths,
} from "../../src/lib/cloudflare-media";
import { mediaManifest } from "../../src/lib/media-manifest";
import type { MediaManifestItem } from "../../src/types/media";

const cover = mediaManifest.items.find((item) => item.id === "aeolian-resonance--cover");
if (!cover) throw new Error("Expected the Aeolian Resonance cover in the manifest");

describe("Cloudflare media URL helpers", () => {
  it("normalizes and encodes public object URLs", () => {
    expect(PUBLIC_ASSET_ORIGIN).toBe("https://assets.jasminjiang.com");
    expect(publicAssetUrl("projects/example/a file.jpg")).toBe(
      "https://assets.jasminjiang.com/projects/example/a%20file.jpg",
    );
  });

  it("uses the fixed image transformation policy", () => {
    expect(CLOUDFLARE_IMAGE_QUALITY).toBe(82);
    expect(cloudflareImageUrl("projects/example/cover.jpg", 1279.6)).toBe(
      "https://assets.jasminjiang.com/cdn-cgi/image/width=1280,quality=82,format=auto,fit=scale-down/projects/example/cover.jpg",
    );
    expect(cloudflareImageUrl("projects/example/cover.jpg", 1200, { height: 630, fit: "cover" })).toBe(
      "https://assets.jasminjiang.com/cdn-cgi/image/width=1200,height=630,quality=82,format=auto,fit=cover/projects/example/cover.jpg",
    );
  });

  it("does not advertise responsive widths above the source width", () => {
    expect(responsiveWidths(cover)).toEqual([480, 768, 1280, 1920, 2560]);
    expect(defaultResponsiveImageWidth(cover)).toBe(1280);
    expect(defaultResponsiveImageWidth(cover, true)).toBe(1920);
    expect(cloudflareImageSrcSet(cover).split(", ")).toHaveLength(5);
  });

  it("keeps a scale-down candidate for sources below the smallest fixed width", () => {
    const small = { ...cover, width: 320 } satisfies MediaManifestItem;
    expect(responsiveWidths(small)).toEqual([480]);
  });
});
