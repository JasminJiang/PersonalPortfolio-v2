import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CATEGORY_MAP,
  PROJECT_SLUGS,
  inspectMedia,
  normalizeSourcePath,
  parseArgs,
  parseLegacyProjects,
  sourceFilePath,
  splitDescription,
} from "./lib/media-utils.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = parseArgs(process.argv.slice(2));
const legacyRoot = path.resolve(args["legacy-root"] || path.join(repositoryRoot, ".."));
const projectsDirectory = path.join(repositoryRoot, "src", "content", "projects");
const dataDirectory = path.join(repositoryRoot, "src", "data");
const manifestPath = path.join(dataDirectory, "media-manifest.json");

const projects = parseLegacyProjects(path.join(legacyRoot, "src", "App.tsx"));
if (projects.length !== 21) throw new Error(`Expected 21 projects, received ${projects.length}`);

await mkdir(projectsDirectory, { recursive: true });
await mkdir(dataDirectory, { recursive: true });

const manifestItems = [];

for (const [projectIndex, project] of projects.entries()) {
  const slug = PROJECT_SLUGS.get(project.id);
  if (!slug) throw new Error(`No slug is defined for legacy project ${project.id}`);
  const category = CATEGORY_MAP[project.category];
  if (!category) throw new Error(`Unknown category: ${project.category}`);

  const sourcePaths = [project.image, ...(project.detailImages || [])];
  const mediaIds = [];

  for (const [mediaIndex, sourcePath] of sourcePaths.entries()) {
    const normalizedPath = normalizeSourcePath(sourcePath);
    const role = mediaIndex === 0 ? "cover" : "detail";
    const id = `${slug}--${role === "cover" ? "cover" : String(mediaIndex).padStart(2, "0")}`;
    const sourceFile = sourceFilePath(legacyRoot, normalizedPath);
    const metadata = await inspectMedia(sourceFile);
    const hash = metadata.sha256.slice(0, 16);
    const sequence = String(mediaIndex).padStart(3, "0");
    const webExtension = metadata.kind === "video" ? "mp4" : metadata.hasTransparency ? "png" : "jpg";
    const keyBase = `projects/${slug}/${sequence}-${hash}`;
    const originalKey = `projects/${slug}/original/${sequence}-${hash}.${metadata.sourceExtension}`;
    const alt = project.category === "PHOTOGRAPHY"
      ? `${project.title} — photograph ${mediaIndex + 1}`
      : `${project.title} — ${role === "cover" ? "project cover" : metadata.kind === "video" ? `motion view ${mediaIndex}` : `project view ${mediaIndex}`}`;

    manifestItems.push({
      id,
      scope: "project",
      projectSlug: slug,
      role,
      order: mediaIndex,
      kind: metadata.kind,
      sourcePath: normalizedPath,
      sourceExtension: metadata.sourceExtension,
      width: metadata.width,
      height: metadata.height,
      ...(metadata.durationSeconds ? { durationSeconds: metadata.durationSeconds } : {}),
      bytes: metadata.bytes,
      sha256: metadata.sha256,
      hasTransparency: metadata.hasTransparency,
      alt,
      originalR2Key: originalKey,
      webR2Key: `${keyBase}.${webExtension}`,
      ...(metadata.kind === "video" ? { posterR2Key: `${keyBase}-poster.jpg` } : {}),
    });
    mediaIds.push(id);
  }

  const entry = {
    slug,
    legacyId: project.id,
    order: projectIndex + 1,
    title: project.title,
    category: category[0],
    categoryLabel: category[1],
    year: Number(project.year),
    ...(project.location ? { location: project.location } : {}),
    description: splitDescription(project.description),
    coverMediaId: mediaIds[0],
    mediaIds,
  };

  await writeFile(path.join(projectsDirectory, `${slug}.json`), `${JSON.stringify(entry, null, 2)}\n`, "utf8");
  process.stdout.write(`Imported ${String(projectIndex + 1).padStart(2, "0")}/21 ${slug}\n`);
}

const aboutPath = "about/1.jpg";
const aboutMetadata = await inspectMedia(sourceFilePath(legacyRoot, aboutPath));
const aboutHash = aboutMetadata.sha256.slice(0, 16);
manifestItems.push({
  id: "about--portrait",
  scope: "site",
  projectSlug: null,
  role: "portrait",
  order: 0,
  kind: "image",
  sourcePath: aboutPath,
  sourceExtension: aboutMetadata.sourceExtension,
  width: aboutMetadata.width,
  height: aboutMetadata.height,
  bytes: aboutMetadata.bytes,
  sha256: aboutMetadata.sha256,
  hasTransparency: aboutMetadata.hasTransparency,
  alt: "Portrait of Jasmin Xinjie Jiang",
  originalR2Key: `site/about/original/portrait-${aboutHash}.${aboutMetadata.sourceExtension}`,
  webR2Key: `site/about/portrait-${aboutHash}.jpg`,
});

if (manifestItems.length !== 197) {
  throw new Error(`Expected 197 media items, received ${manifestItems.length}`);
}

const manifest = {
  version: 1,
  assetOrigin: "https://assets.jasminjiang.com",
  originalBucket: "jasminjiang-originals",
  webBucket: "jasminjiang-web-media",
  responsiveImageWidths: [480, 768, 1280, 1920, 2560, 3840],
  items: manifestItems,
};

await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
process.stdout.write(`Wrote ${manifestItems.length} verified media records to ${path.relative(repositoryRoot, manifestPath)}\n`);
