import { cloudflareImageUrl } from "./cloudflare-media";
import { mediaById } from "./media-manifest";

export const SITE_ORIGIN = "https://jasminjiang.com";
export const SITE_NAME = "Jasmin Xinjie Jiang";
export const DEFAULT_TITLE = "Jasmin Xinjie Jiang — Multidisciplinary Designer";
export const DEFAULT_DESCRIPTION =
  "Portfolio of Jasmin Xinjie Jiang, a multidisciplinary designer working across architecture, immersive media, UI/UX, and photography.";

const defaultCover = mediaById.get("aeolian-resonance--cover");
if (!defaultCover) throw new Error("Default social cover is missing from the media manifest");

export const DEFAULT_SOCIAL_IMAGE = cloudflareImageUrl(defaultCover.webR2Key, 1200, {
  height: 630,
  fit: "cover",
});

export const personStructuredData = {
  "@type": "Person",
  "@id": `${SITE_ORIGIN}/#person`,
  name: SITE_NAME,
  alternateName: "Xinjie Jiang",
  url: SITE_ORIGIN,
  jobTitle: "Multidisciplinary designer",
  email: "mailto:ahorajiang@gmail.com",
  sameAs: [
    "https://www.linkedin.com/in/xinjie-jiang-71811b369",
    "https://www.instagram.com/jjjasminx1236/",
  ],
  knowsAbout: ["Architecture", "Immersive media", "UI/UX", "Photography"],
};

export function serializeStructuredData(value: unknown) {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

export function toMetaDescription(value: string, maximumLength = 160) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maximumLength) return normalized;
  const candidate = normalized.slice(0, maximumLength - 1).replace(/\s+\S*$/, "").trimEnd();
  return `${candidate || normalized.slice(0, maximumLength - 1)}…`;
}
