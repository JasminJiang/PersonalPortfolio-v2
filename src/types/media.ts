export const RESPONSIVE_IMAGE_WIDTHS = [480, 768, 1280, 1920, 2560, 3840] as const;

export type MediaKind = "image" | "video";
export type MediaRole = "cover" | "detail" | "portrait";

export interface MediaManifestItem {
  id: string;
  scope: "project" | "site";
  projectSlug: string | null;
  role: MediaRole;
  order: number;
  kind: MediaKind;
  sourcePath: string;
  sourceExtension: string;
  width: number;
  height: number;
  durationSeconds?: number;
  bytes: number;
  sha256: string;
  hasTransparency: boolean;
  alt: string;
  originalR2Key: string;
  webR2Key: string;
  posterR2Key?: string;
}

export interface MediaManifest {
  version: 1;
  assetOrigin: string;
  originalBucket: string;
  webBucket: string;
  responsiveImageWidths: readonly number[];
  items: MediaManifestItem[];
}
