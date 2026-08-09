import { mediaManifest } from "./media-manifest";
import type { MediaManifestItem } from "../types/media";

const configuredOrigin = import.meta.env.PUBLIC_ASSET_ORIGIN || mediaManifest.assetOrigin;

export const PUBLIC_ASSET_ORIGIN = configuredOrigin.replace(/\/+$/, "");
export const CLOUDFLARE_IMAGE_QUALITY = 82;

function encodeObjectKey(key: string) {
  return key.split("/").map((segment) => encodeURIComponent(segment)).join("/");
}

export function publicAssetUrl(key: string) {
  return `${PUBLIC_ASSET_ORIGIN}/${encodeObjectKey(key)}`;
}

export function cloudflareImageUrl(
  key: string,
  width: number,
  options: {
    quality?: number;
    format?: "auto" | "avif" | "webp" | "json";
    fit?: "scale-down" | "contain" | "cover";
    height?: number;
  } = {},
) {
  const quality = options.quality ?? CLOUDFLARE_IMAGE_QUALITY;
  const format = options.format ?? "auto";
  const fit = options.fit ?? "scale-down";
  const dimensions = [`width=${Math.round(width)}`];
  if (options.height) dimensions.push(`height=${Math.round(options.height)}`);
  const transformations = `${dimensions.join(",")},quality=${quality},format=${format},fit=${fit}`;
  return `${PUBLIC_ASSET_ORIGIN}/cdn-cgi/image/${transformations}/${encodeObjectKey(key)}`;
}

export function responsiveWidths(media: MediaManifestItem) {
  const candidates = mediaManifest.responsiveImageWidths.filter((width) => width <= media.width);
  return candidates.length > 0 ? candidates : [mediaManifest.responsiveImageWidths[0]!];
}

export function defaultResponsiveImageWidth(media: MediaManifestItem, eager = false) {
  const widths = responsiveWidths(media);
  return widths[Math.min(widths.length - 1, eager ? 3 : 2)]!;
}

export function cloudflareImageSrcSet(media: MediaManifestItem) {
  return responsiveWidths(media)
    .map((width) => `${cloudflareImageUrl(media.webR2Key, width)} ${width}w`)
    .join(", ");
}
