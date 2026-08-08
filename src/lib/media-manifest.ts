import { z } from "astro/zod";
import manifestJson from "../data/media-manifest.json";
import type { MediaManifest } from "../types/media";

const keySchema = z.string().regex(/^[a-z0-9][a-z0-9/.-]*$/);
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

export const mediaManifestItemSchema = z.object({
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*(?:--[a-z0-9-]+)$/),
  scope: z.enum(["project", "site"]),
  projectSlug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).nullable(),
  role: z.enum(["cover", "detail", "portrait"]),
  order: z.number().int().min(0),
  kind: z.enum(["image", "video"]),
  sourcePath: z.string().min(1),
  sourceExtension: z.string().regex(/^[a-z0-9]+$/),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  durationSeconds: z.number().positive().optional(),
  bytes: z.number().int().positive(),
  sha256: sha256Schema,
  hasTransparency: z.boolean(),
  alt: z.string().min(1),
  originalR2Key: keySchema,
  webR2Key: keySchema,
  posterR2Key: keySchema.optional(),
}).strict().superRefine((item, context) => {
  if (item.kind === "video" && !item.posterR2Key) {
    context.addIssue({ code: "custom", message: "Video entries require a posterR2Key" });
  }
  if (item.scope === "project" && !item.projectSlug) {
    context.addIssue({ code: "custom", message: "Project media requires projectSlug" });
  }
});

export const mediaManifestSchema = z.object({
  version: z.literal(1),
  assetOrigin: z.literal("https://assets.jasminjiang.com"),
  originalBucket: z.literal("jasminjiang-originals"),
  webBucket: z.literal("jasminjiang-web-media"),
  responsiveImageWidths: z.tuple([
    z.literal(480),
    z.literal(768),
    z.literal(1280),
    z.literal(1920),
    z.literal(2560),
    z.literal(3840),
  ]),
  items: z.array(mediaManifestItemSchema).length(197),
}).strict();

export const mediaManifest = mediaManifestSchema.parse(manifestJson) as MediaManifest;
export const mediaById = new Map(mediaManifest.items.map((item) => [item.id, item]));
