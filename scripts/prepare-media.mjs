import { access, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseArgs, sourceFilePath } from "./lib/media-utils.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = parseArgs(process.argv.slice(2));
if (!args["legacy-root"]) throw new Error("Pass --legacy-root <path> to the private legacy checkout");

const legacyRoot = path.resolve(args["legacy-root"]);
const outputRoot = path.resolve(args.output || path.join(repositoryRoot, ".media-work"));
const manifest = JSON.parse(await readFile(path.join(repositoryRoot, "src", "data", "media-manifest.json"), "utf8"));
const { default: sharp } = await import("sharp");

async function run(command, commandArgs) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, { stdio: "inherit", windowsHide: true });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`)));
  });
}

async function commandExists(command) {
  try {
    await run(command, ["-version"]);
    return true;
  } catch {
    return false;
  }
}

const hasFfmpeg = await commandExists(args.ffmpeg || "ffmpeg");
if (manifest.items.some((item) => item.kind === "video") && !hasFfmpeg) {
  throw new Error("ffmpeg is required to prepare video files and posters. Install it or pass --ffmpeg <path>.");
}

for (const [index, item] of manifest.items.entries()) {
  const source = sourceFilePath(legacyRoot, item.sourcePath);
  await access(source);
  const webOutput = path.join(outputRoot, "web", ...item.webR2Key.split("/"));
  await mkdir(path.dirname(webOutput), { recursive: true });

  if (item.kind === "image") {
    let pipeline = sharp(source).rotate().resize({ width: 3840, height: 3840, fit: "inside", withoutEnlargement: true }).toColorspace("srgb");
    pipeline = item.hasTransparency
      ? pipeline.png({ compressionLevel: 9, adaptiveFiltering: true })
      : pipeline.jpeg({ quality: 82, mozjpeg: true, chromaSubsampling: "4:4:4" });
    // Sharp strips source metadata by default. `rotate()` applies EXIF orientation
    // before the new sRGB file is written without EXIF or GPS fields.
    await pipeline.toFile(webOutput);
  } else {
    await run(args.ffmpeg || "ffmpeg", [
      "-y", "-i", source,
      "-vf", "scale=w='min(1920,iw)':h='min(1080,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,fps=fps='min(source_fps,60)'",
      "-c:v", "libx264", "-preset", "slow", "-crf", "20", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", webOutput,
    ]);
    const posterOutput = path.join(outputRoot, "web", ...item.posterR2Key.split("/"));
    await mkdir(path.dirname(posterOutput), { recursive: true });
    await run(args.ffmpeg || "ffmpeg", [
      "-y", "-ss", "0", "-i", source, "-frames:v", "1",
      "-vf", "scale=w='min(1920,iw)':h='min(1080,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2",
      "-q:v", "2", "-update", "1", posterOutput,
    ]);
  }

  process.stdout.write(`Prepared ${String(index + 1).padStart(3, "0")}/${manifest.items.length} ${item.id}\n`);
}

process.stdout.write(`Prepared web media under ${outputRoot}\n`);
