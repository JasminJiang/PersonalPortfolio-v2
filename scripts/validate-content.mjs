import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, sourceFilePath } from "./lib/media-utils.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = parseArgs(process.argv.slice(2));
const projectsDirectory = path.join(repositoryRoot, "src", "content", "projects");
const manifest = JSON.parse(await readFile(path.join(repositoryRoot, "src", "data", "media-manifest.json"), "utf8"));
const projectFiles = (await readdir(projectsDirectory)).filter((file) => file.endsWith(".json")).sort();

const failures = [];
const assert = (condition, message) => {
  if (!condition) failures.push(message);
};

assert(projectFiles.length > 0, "Expected at least one project file");
assert(manifest.version === 1, "Media manifest version must be 1");
assert(manifest.items?.length > 0, "Expected at least one media record");
assert(manifest.assetOrigin === "https://assets.jasminjiang.com", "Unexpected public asset origin");

const ids = new Set();
const sourcePaths = new Set();
const originalKeys = new Set();
const webKeys = new Set();
for (const item of manifest.items || []) {
  assert(!ids.has(item.id), `Duplicate media id: ${item.id}`);
  assert(!sourcePaths.has(item.sourcePath), `Duplicate source path: ${item.sourcePath}`);
  assert(!originalKeys.has(item.originalR2Key), `Duplicate originals key: ${item.originalR2Key}`);
  assert(!webKeys.has(item.webR2Key), `Duplicate web key: ${item.webR2Key}`);
  assert(/^[a-f0-9]{64}$/.test(item.sha256), `Invalid SHA-256 for ${item.id}`);
  assert(item.width > 0 && item.height > 0, `Invalid dimensions for ${item.id}`);
  assert(item.bytes > 0, `Invalid byte count for ${item.id}`);
  assert(typeof item.alt === "string" && item.alt.trim().length > 0, `Missing alt text for ${item.id}`);
  assert(item.kind !== "video" || Boolean(item.posterR2Key), `Missing video poster key for ${item.id}`);
  ids.add(item.id);
  sourcePaths.add(item.sourcePath);
  originalKeys.add(item.originalR2Key);
  webKeys.add(item.webR2Key);
  if (item.posterR2Key) {
    assert(!webKeys.has(item.posterR2Key), `Duplicate poster key: ${item.posterR2Key}`);
    webKeys.add(item.posterR2Key);
  }
}

const slugs = new Set();
const orders = new Set();
for (const file of projectFiles) {
  const project = JSON.parse(await readFile(path.join(projectsDirectory, file), "utf8"));
  const expectedSlug = file.replace(/\.json$/, "");
  assert(project.slug === expectedSlug, `Slug mismatch in ${file}`);
  assert(!slugs.has(project.slug), `Duplicate project slug: ${project.slug}`);
  assert(!orders.has(project.order), `Duplicate project order: ${project.order}`);
  assert(project.coverMediaId === project.mediaIds?.[0], `Cover must be the first media item for ${project.slug}`);
  assert(project.mediaIds?.every((id) => ids.has(id)), `Unknown media id in ${project.slug}`);
  for (const pair of project.comparisonPairs || []) {
    assert(project.mediaIds?.includes(pair.originalMediaId), `Comparison original is absent from mediaIds for ${project.slug}`);
    assert(project.mediaIds?.includes(pair.compositeMediaId), `Comparison composite is absent from mediaIds for ${project.slug}`);
    const original = manifest.items.find((item) => item.id === pair.originalMediaId);
    const composite = manifest.items.find((item) => item.id === pair.compositeMediaId);
    assert(original?.kind === "image", `Comparison original must be an image for ${project.slug}`);
    assert(composite?.kind === "image", `Comparison composite must be an image for ${project.slug}`);
  }
  const manifestIds = (manifest.items || []).filter((item) => item.projectSlug === project.slug).map((item) => item.id);
  assert(JSON.stringify(project.mediaIds) === JSON.stringify(manifestIds), `Media ordering mismatch for ${project.slug}`);
  slugs.add(project.slug);
  orders.add(project.order);
}

if (args["legacy-root"]) {
  const legacyRoot = path.resolve(args["legacy-root"]);
  for (const item of manifest.items || []) {
    const filePath = sourceFilePath(legacyRoot, item.sourcePath);
    const contents = await readFile(filePath);
    assert(contents.byteLength === item.bytes, `Byte count changed for ${item.sourcePath}`);
    if (args.deep) {
      const digest = createHash("sha256").update(contents).digest("hex");
      assert(digest === item.sha256, `SHA-256 changed for ${item.sourcePath}`);
    }
  }
}

if (failures.length) {
  process.stderr.write(`${failures.map((failure) => `- ${failure}`).join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`Validated ${projectFiles.length} projects and ${manifest.items.length} media records${args.deep ? " with SHA-256 verification" : ""}.\n`);
}
