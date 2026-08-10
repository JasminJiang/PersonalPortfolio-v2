import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "./lib/media-utils.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = parseArgs(process.argv.slice(2));
const manifest = JSON.parse(await readFile(path.join(repositoryRoot, "src", "data", "media-manifest.json"), "utf8"));
const origin = String(args.origin || process.env.PUBLIC_ASSET_ORIGIN || manifest.assetOrigin).replace(/\/+$/, "");
const reportDirectory = path.resolve(args.output || path.join(repositoryRoot, ".media-work", "verification"));
const corsOrigin = String(args["cors-origin"] || "https://jasminjiang.com");

function encodeKey(key) {
  return key.split("/").map((segment) => encodeURIComponent(segment)).join("/");
}

async function mapWithConcurrency(values, concurrency, worker) {
  const results = new Array(values.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(values[index], index);
    }
  }));
  return results;
}

const publicObjects = manifest.items.flatMap((item) => [
  { key: item.webR2Key, kind: item.kind },
  ...(item.posterR2Key ? [{ key: item.posterR2Key, kind: "image" }] : []),
]);

const expectedObjectCount = publicObjects.length;

const objectChecks = await mapWithConcurrency(publicObjects, 8, async (object, index) => {
  const url = `${origin}/${encodeKey(object.key)}`;
  try {
    const response = await fetch(url, { method: "HEAD", headers: { Origin: corsOrigin } });
    const cacheControl = response.headers.get("cache-control") || "";
    const contentType = response.headers.get("content-type") || "";
    const allowOrigin = response.headers.get("access-control-allow-origin") || "";
    const expectedType = object.kind === "video" ? "video/mp4" : "image/";
    const errors = [
      ...(!response.ok ? [`HTTP ${response.status}`] : []),
      ...(!cacheControl.includes("max-age=31536000") || !cacheControl.includes("immutable") ? ["cache-control"] : []),
      ...(!contentType.startsWith(expectedType) ? [`content-type ${contentType || "missing"}`] : []),
      ...(!["*", corsOrigin].includes(allowOrigin) ? [`cors ${allowOrigin || "missing"}`] : []),
    ];
    process.stdout.write(`Checked object ${String(index + 1).padStart(3, "0")}/${expectedObjectCount} ${object.key}\n`);
    return { key: object.key, url, ok: errors.length === 0, status: response.status, errors };
  } catch (error) {
    return { key: object.key, url, ok: false, status: 0, errors: [error instanceof Error ? error.message : String(error)] };
  }
});

const transformCandidates = manifest.items
  .filter((item) => item.kind === "image")
  .filter((item, index) => index % 16 === 0 || item.role === "portrait")
  .slice(0, 16);

const transformationChecks = await mapWithConcurrency(transformCandidates, 4, async (item) => {
  const url = `${origin}/cdn-cgi/image/width=480,quality=82,format=auto,fit=scale-down/${encodeKey(item.webR2Key)}`;
  try {
    const response = await fetch(url, { headers: { Accept: "image/avif,image/webp,image/*", Origin: corsOrigin } });
    const contentType = response.headers.get("content-type") || "";
    const allowOrigin = response.headers.get("access-control-allow-origin") || "";
    await response.body?.cancel();
    const errors = [
      ...(!response.ok ? [`HTTP ${response.status}`] : []),
      ...(!contentType.startsWith("image/") ? [`content-type ${contentType || "missing"}`] : []),
      ...(!["*", corsOrigin].includes(allowOrigin) ? [`cors ${allowOrigin || "missing"}`] : []),
    ];
    return { key: item.webR2Key, url, ok: errors.length === 0, status: response.status, contentType, errors };
  } catch (error) {
    return { key: item.webR2Key, url, ok: false, status: 0, contentType: "", errors: [error instanceof Error ? error.message : String(error)] };
  }
});

const report = {
  checkedAt: new Date().toISOString(),
  origin,
  expectedObjects: expectedObjectCount,
  objectChecks,
  transformationChecks,
  passed: objectChecks.every((check) => check.ok) && transformationChecks.every((check) => check.ok),
};

await mkdir(reportDirectory, { recursive: true });
await writeFile(path.join(reportDirectory, "public-r2-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");

if (!report.passed) {
  const failures = [...objectChecks, ...transformationChecks].filter((check) => !check.ok);
  throw new Error(`Public R2 verification failed for ${failures.length} checks. See ${reportDirectory}`);
}

process.stdout.write(`Verified ${objectChecks.length} public objects and ${transformationChecks.length} transformations.\n`);
