import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseArgs, sha256File } from "./lib/media-utils.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = parseArgs(process.argv.slice(2));
const manifest = JSON.parse(await readFile(path.join(repositoryRoot, "src", "data", "media-manifest.json"), "utf8"));
const preparedRoot = path.resolve(args["prepared-root"] || path.join(repositoryRoot, ".media-work", "web"));
const verificationRoot = path.resolve(args.output || path.join(repositoryRoot, ".media-work", "web-r2-verification"));
const downloadsRoot = path.join(verificationRoot, "downloads");
const wranglerCli = path.join(repositoryRoot, "node_modules", "wrangler", "bin", "wrangler.js");

const expectedObjects = manifest.items.flatMap((item) => [
  { id: item.id, key: item.webR2Key },
  ...(item.posterR2Key ? [{ id: `${item.id}--poster`, key: item.posterR2Key }] : []),
]);
const limit = args.limit ? Number(args.limit) : expectedObjects.length;
const selectedObjects = expectedObjects.slice(0, limit);

if (!Number.isInteger(limit) || limit <= 0 || limit > expectedObjects.length) {
  throw new Error(`--limit must be between 1 and ${expectedObjects.length}`);
}

function assertWithinRoot(root, target, label) {
  const relative = path.relative(root, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`Unsafe ${label} path: ${target}`);
}

async function downloadObject(key, destination) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      wranglerCli,
      "r2",
      "object",
      "get",
      `${manifest.webBucket}/${key}`,
      "--file",
      destination,
      "--remote",
    ], { windowsHide: true, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`wrangler exited with ${code}`)));
  });
}

await mkdir(downloadsRoot, { recursive: true });
const checks = [];

for (const [index, object] of selectedObjects.entries()) {
  const preparedFile = path.resolve(preparedRoot, ...object.key.split("/"));
  const temporaryFile = path.resolve(downloadsRoot, ...object.key.split("/"));
  assertWithinRoot(preparedRoot, preparedFile, "prepared media");
  assertWithinRoot(downloadsRoot, temporaryFile, "download");
  await mkdir(path.dirname(temporaryFile), { recursive: true });

  try {
    const expectedSha256 = await sha256File(preparedFile);
    await downloadObject(object.key, temporaryFile);
    const actualSha256 = await sha256File(temporaryFile);
    const ok = actualSha256 === expectedSha256;
    checks.push({ id: object.id, key: object.key, expectedSha256, actualSha256, ok });
    await unlink(temporaryFile);
    if (!ok) break;
    process.stdout.write(`Verified web object ${String(index + 1).padStart(3, "0")}/${selectedObjects.length} ${object.id}\n`);
  } catch (error) {
    checks.push({
      id: object.id,
      key: object.key,
      expectedSha256: null,
      actualSha256: null,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
    break;
  }
}

const report = {
  checkedAt: new Date().toISOString(),
  bucket: manifest.webBucket,
  expectedObjects: expectedObjects.length,
  checkedObjects: checks.length,
  fullVerification: selectedObjects.length === expectedObjects.length,
  passed: checks.length === selectedObjects.length && checks.every((check) => check.ok),
  checks,
};

await writeFile(path.join(verificationRoot, "web-r2-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");

if (!report.passed) throw new Error(`Web R2 verification failed. See ${verificationRoot}`);
process.stdout.write(`${report.fullVerification ? "Fully verified" : "Partially verified"} ${checks.length} web objects.\n`);
