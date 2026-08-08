import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";

const slugSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const mediaIdSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*(?:--[a-z0-9-]+)$/);

const projects = defineCollection({
  loader: glob({ pattern: "**/*.json", base: "./src/content/projects" }),
  schema: z.object({
    slug: slugSchema,
    legacyId: z.string().min(1),
    order: z.number().int().min(1).max(21),
    title: z.string().min(1),
    category: z.enum(["architecture", "immersive-media", "ui-ux", "photography"]),
    categoryLabel: z.string().min(1),
    year: z.number().int().min(2000).max(2100),
    location: z.string().min(1).optional(),
    description: z.array(z.string().min(1)),
    coverMediaId: mediaIdSchema,
    mediaIds: z.array(mediaIdSchema).min(1),
  }),
});

export const collections = { projects };
