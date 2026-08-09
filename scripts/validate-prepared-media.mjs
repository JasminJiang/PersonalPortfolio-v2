import { access, open, readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "./lib/media-utils.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = parseArgs(process.argv.slice(2));
const mediaRoot = path.resolve(args["media-root"] || path.join(repositoryRoot, ".media-work"));
const ffprobe = args.ffprobe || "ffprobe";
const manifest = JSON.parse(await readFile(path.join(repositoryRoot, "src", "data", "media-manifest.json"), "utf8"));
const { default: sharp } = await import("sharp");

async function probe(filePath) {
  const output = await new Promise((resolve, reject) => {
    const chunks = [];
    const child = spawn(ffprobe, ["-v", "error", "-show_streams", "-show_format", "-of", "json", filePath], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "inherit"],
    });
    child.stdout.on("data", (chunk) => chunks.push(chunk));
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve(Buffer.concat(chunks).toString("utf8")) : reject(new Error(`ffprobe exited with ${code}`)));
  });
  return JSON.parse(output);
}

function frameRate(value = "0/1") {
  const [numerator, denominator] = value.split("/").map(Number);
  return denominator ? numerator / denominator : 0;
}

const failures = [];
let checkedFiles = 0;

for (const item of manifest.items) {
  const webFile = path.join(mediaRoot, "web", ...item.webR2Key.split("/"));
  await access(webFile);

  if (item.kind === "image") {
    const metadata = await sharp(webFile).metadata();
    const expectedFormat = item.hasTransparency ? "png" : "jpeg";
    const errors = [
      ...(metadata.format !== expectedFormat ? [`format ${metadata.format}`] : []),
      ...((metadata.width || 0) > 3840 || (metadata.height || 0) > 3840 ? [`dimensions ${metadata.width}x${metadata.height}`] : []),
      ...(metadata.exif ? ["EXIF metadata present"] : []),
    ];
    if (errors.length) failures.push({ id: item.id, file: webFile, errors });
    checkedFiles += 1;
    continue;
  }

  const information = await probe(webFile);
  const video = information.streams.find((stream) => stream.codec_type === "video");
  const audio = information.streams.find((stream) => stream.codec_type === "audio");
  const fileHandle = await open(webFile, "r");
  const firstChunk = Buffer.allocUnsafe(2 * 1024 * 1024);
  const { bytesRead } = await fileHandle.read(firstChunk, 0, firstChunk.length, 0);
  await fileHandle.close();
  const header = firstChunk.subarray(0, bytesRead);
  const moovPosition = header.indexOf(Buffer.from("moov"));
  const mdatPosition = header.indexOf(Buffer.from("mdat"));
  const errors = [
    ...(!video ? ["video stream missing"] : []),
    ...(video?.codec_name !== "h264" ? [`video codec ${video?.codec_name}`] : []),
    ...(video?.pix_fmt !== "yuv420p" ? [`pixel format ${video?.pix_fmt}`] : []),
    ...((video?.width || 0) > 1920 || (video?.height || 0) > 1080 ? [`dimensions ${video?.width}x${video?.height}`] : []),
    ...(frameRate(video?.avg_frame_rate) > 60.01 ? [`frame rate ${frameRate(video?.avg_frame_rate)}`] : []),
    ...(audio && audio.codec_name !== "aac" ? [`audio codec ${audio.codec_name}`] : []),
    ...(moovPosition < 0 || mdatPosition < 0 || moovPosition > mdatPosition ? ["faststart moov atom missing"] : []),
  ];
  if (errors.length) failures.push({ id: item.id, file: webFile, errors });
  checkedFiles += 1;

  const posterFile = path.join(mediaRoot, "web", ...item.posterR2Key.split("/"));
  await access(posterFile);
  const poster = await sharp(posterFile).metadata();
  const posterErrors = [
    ...(poster.format !== "jpeg" ? [`format ${poster.format}`] : []),
    ...((poster.width || 0) > 1920 || (poster.height || 0) > 1080 ? [`dimensions ${poster.width}x${poster.height}`] : []),
    ...(poster.exif ? ["EXIF metadata present"] : []),
  ];
  if (posterErrors.length) failures.push({ id: `${item.id}--poster`, file: posterFile, errors: posterErrors });
  checkedFiles += 1;
}

if (checkedFiles !== 206) throw new Error(`Expected 206 prepared files, checked ${checkedFiles}`);
if (failures.length) throw new Error(`Prepared media validation failed:\n${JSON.stringify(failures, null, 2)}`);

process.stdout.write("Validated 206 prepared files: image dimensions/metadata, video H.264/yuv420p/faststart, and posters.\n");
