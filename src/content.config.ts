import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";

const slugSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const mediaIdSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*(?:--[a-z0-9-]+)$/);
const photographyDisciplineSchema = z.enum([
  "humanist",
  "wedding-bridal",
  "product-still-life",
  "commercial-portrait",
  "runway-backstage",
  "aigc-photography",
]);

const projects = defineCollection({
  loader: glob({ pattern: "**/*.json", base: "./src/content/projects" }),
  schema: z.object({
    slug: slugSchema,
    legacyId: z.string().min(1),
    order: z.number().int().min(1),
    title: z.string().min(1),
    category: z.enum(["architecture", "immersive-media", "ui-ux", "photography"]),
    categoryLabel: z.string().min(1),
    photographyDiscipline: photographyDisciplineSchema.optional(),
    year: z.number().int().min(2000).max(2100),
    location: z.string().min(1).optional(),
    description: z.array(z.string().min(1)),
    coverMediaId: mediaIdSchema,
    coverGravity: z.string().regex(/^(?:auto|face|left|right|top|bottom|(?:0(?:\.\d+)?|1(?:\.0+)?)x(?:0(?:\.\d+)?|1(?:\.0+)?))$/).optional(),
    mediaIds: z.array(mediaIdSchema).min(1),
    comparisonPairs: z.array(z.object({
      originalMediaId: mediaIdSchema,
      compositeMediaId: mediaIdSchema,
    }).strict()).min(1).optional(),
  }).superRefine((project, context) => {
    if (project.category === "photography" && !project.photographyDiscipline) {
      context.addIssue({
        code: "custom",
        message: "Photography projects require a photographyDiscipline.",
        path: ["photographyDiscipline"],
      });
    }
    if (project.category !== "photography" && project.photographyDiscipline) {
      context.addIssue({
        code: "custom",
        message: "Only photography projects may define photographyDiscipline.",
        path: ["photographyDiscipline"],
      });
    }
  }),
});

export const collections = { projects };
