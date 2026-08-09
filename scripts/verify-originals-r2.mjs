import { copyFile, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseArgs, sha256File } from "./lib/media-utils.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = parseArgs(process.argv.slice(2));
const manifest = JSON.parse(await readFile(path.join(repositoryRoot, "src", "data", "media-manifest.json"), "utf8"));
const verificationRoot = path.resolve(args.output || path.join(repositoryRoot, ".media-work", "originals-verification"));
const downloadsRoot = path.join(verificationRoot, "downloads");
const restoreRoot = path.join(verificationRoot, "restore-test");
const restoreId = String(args["restore-id"] || manifest.items[0].id);
const limit = args.limit ? Number(args.limit) : manifest.items.length;
const selectedItems = manifest.items.slice(0, limit);
const wranglerCli = path.join(repositoryRoot, "node_modules", "wrangler", "bin", "wrangler.js");

if (!Number.isInteger(limit) || limit <= 0 || limit > manifest.items.length) {
  throw new Error(`--limit must be between 1 and ${manifest.items.length}`);
}
if (!manifest.items.some((item) => item.id === restoreId)) throw new Error(`Unknown --restore-id ${restoreId}`);
if (!selectedItems.some((item) => item.id === restoreId)) {
  throw new Error(`--restore-id ${restoreId} is outside the selected --limit range`);
}

async function downloadOriginal(item, destination) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      wranglerCli,
      "r2",
      "object",
      "get",
      `${manifest.originalBucket}/${item.originalR2Key}`,
      "--file",
      destination,
      "--remote",
    ], { windowsHide: true, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`wrangler exited with ${code}`)));
  });
}

await mkdir(downloadsRoot, { recursive: true });
await mkdir(restoreRoot, { recursive: true });
const checks = [];

for (const [index, item] of selectedItems.entries()) {
  const temporaryFile = path.join(downloadsRoot, `${item.id}.${item.sourceExtension}`);
  try {
    await downloadOriginal(item, temporaryFile);
    const actualSha256 = await sha256File(temporaryFile);
    const ok = actualSha256 === item.sha256;
    if (!ok) {
      checks.push({ id: item.id, key: item.originalR2Key, expectedSha256: item.sha256, actualSha256, ok: false });
      break;
    }

    if (item.id === restoreId) {
      const restoredFile = path.resolve(restoreRoot, ...item.sourcePath.split("/"));
      if (!restoredFile.startsWith(`${restoreRoot}${path.sep}`)) throw new Error(`Unsafe restore path for ${item.id}`);
      await mkdir(path.dirname(restoredFile), { recursive: true });
      await copyFile(temporaryFile, restoredFile);
    }

    await unlink(temporaryFile);
    checks.push({ id: item.id, key: item.originalR2Key, expectedSha256: item.sha256, actualSha256, ok: true });
    process.stdout.write(`Verified original ${String(index + 1).padStart(3, "0")}/${selectedItems.length} ${item.id}\n`);
  } catch (error) {
    checks.push({
      id: item.id,
      key: item.originalR2Key,
      expectedSha256: item.sha256,
      actualSha256: null,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
    break;
  }
}

const report = {
  checkedAt: new Date().toISOString(),
  bucket: manifest.originalBucket,
  expectedObjects: manifest.items.length,
  checkedObjects: checks.length,
  restoreId,
  fullVerification: selectedItems.length === manifest.items.length,
  passed: checks.length === selectedItems.length && checks.every((check) => check.ok),
  checks,
};

await writeFile(path.join(verificationRoot, "originals-r2-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");

if (!report.passed) throw new Error(`Originals R2 verification failed. See ${verificationRoot}`);
process.stdout.write(`${report.fullVerification ? "Fully verified" : "Partially verified"} ${checks.length} originals; restore sample: ${restoreId}.\n`);
