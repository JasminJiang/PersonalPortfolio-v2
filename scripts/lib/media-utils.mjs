import { createHash } from "node:crypto";
import { createReadStream, existsSync, readFileSync } from "node:fs";
import { stat } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

const ts = createRequire(import.meta.url)("typescript");

export const PROJECT_SLUGS = new Map([
  ["01", "aeolian-resonance"],
  ["02", "waterborne-urbanism"],
  ["03", "voltlab-architecture"],
  ["04", "cyan-pavilion"],
  ["05", "orbit-shelter"],
  ["06", "piece-on-utopia"],
  ["07", "ash-and-arbor"],
  ["16", "behind-the-mask"],
  ["17", "lumen-quest-vr"],
  ["18", "voltlab-uiux"],
  ...Array.from({ length: 11 }, (_, index) => {
    const number = String(index + 1).padStart(2, "0");
    return [`P${number}`, `photography-${number}`];
  }),
]);

export const CATEGORY_MAP = {
  "ARCHITECTURE DESIGN": ["architecture", "Architecture Design"],
  MR: ["immersive-media", "Immersive Media"],
  UIUX: ["ui-ux", "UI/UX"],
  PHOTOGRAPHY: ["photography", "Photography"],
};

export function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token?.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      values[key] = true;
    } else {
      values[key] = next;
      index += 1;
    }
  }
  return values;
}

export function parseLegacyProjects(appPath) {
  const source = readFileSync(appPath, "utf8");
  const sourceFile = ts.createSourceFile(appPath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

  const parseLiteral = (node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
    if (ts.isNumericLiteral(node)) return Number(node.text);
    if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
    if (node.kind === ts.SyntaxKind.NullKeyword) return null;
    if (ts.isArrayLiteralExpression(node)) return node.elements.map(parseLiteral);
    if (ts.isObjectLiteralExpression(node)) {
      return Object.fromEntries(node.properties.map((property) => {
        if (!ts.isPropertyAssignment(property)) {
          throw new Error(`Unsupported project property in ${appPath}: ${property.getText(sourceFile)}`);
        }
        const name = ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)
          ? property.name.text
          : property.name.getText(sourceFile);
        return [name, parseLiteral(property.initializer)];
      }));
    }
    throw new Error(`Unsupported project value in ${appPath}: ${node.getText(sourceFile)}`);
  };

  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== "projects" || !declaration.initializer) continue;
      const projects = parseLiteral(declaration.initializer);
      if (!Array.isArray(projects)) throw new Error("Legacy project data is not an array");
      return projects;
    }
  }

  throw new Error(`Could not find the project array in ${appPath}`);
}

export function splitDescription(description = "") {
  return description
    .split(/\r?\n\s*\r?\n/g)
    .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

export function normalizeSourcePath(sourcePath) {
  return sourcePath.replace(/^\/+/, "").replaceAll("\\", "/");
}

export function sourceFilePath(legacyRoot, sourcePath) {
  const normalized = normalizeSourcePath(sourcePath);
  const filePath = path.resolve(legacyRoot, "public", ...normalized.split("/"));
  const publicRoot = path.resolve(legacyRoot, "public");
  if (!filePath.startsWith(`${publicRoot}${path.sep}`)) {
    throw new Error(`Source path escapes the public directory: ${sourcePath}`);
  }
  return filePath;
}

export async function sha256File(filePath) {
  return await new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function readBoxes(buffer, start = 0, end = buffer.length) {
  const boxes = [];
  let offset = start;

  while (offset + 8 <= end) {
    let size = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    let headerSize = 8;

    if (size === 1) {
      if (offset + 16 > end) break;
      size = Number(buffer.readBigUInt64BE(offset + 8));
      headerSize = 16;
    } else if (size === 0) {
      size = end - offset;
    }

    if (size < headerSize || offset + size > end) break;
    boxes.push({ type, start: offset, size, headerSize, dataStart: offset + headerSize, end: offset + size });
    offset += size;
  }

  return boxes;
}

function findChild(buffer, parent, type) {
  return readBoxes(buffer, parent.dataStart, parent.end).find((box) => box.type === type);
}

function parseMp4Metadata(filePath) {
  const buffer = readFileSync(filePath);
  const moov = readBoxes(buffer).find((box) => box.type === "moov");
  if (!moov) throw new Error(`MP4 has no moov box: ${filePath}`);

  const mvhd = findChild(buffer, moov, "mvhd");
  let durationSeconds;
  if (mvhd) {
    const version = buffer.readUInt8(mvhd.dataStart);
    const timescaleOffset = mvhd.dataStart + (version === 1 ? 20 : 12);
    const durationOffset = mvhd.dataStart + (version === 1 ? 24 : 16);
    const timescale = buffer.readUInt32BE(timescaleOffset);
    const duration = version === 1
      ? Number(buffer.readBigUInt64BE(durationOffset))
      : buffer.readUInt32BE(durationOffset);
    if (timescale > 0) durationSeconds = Number((duration / timescale).toFixed(3));
  }

  const tracks = readBoxes(buffer, moov.dataStart, moov.end).filter((box) => box.type === "trak");
  for (const track of tracks) {
    const mdia = findChild(buffer, track, "mdia");
    const hdlr = mdia && findChild(buffer, mdia, "hdlr");
    if (!hdlr || buffer.toString("ascii", hdlr.dataStart + 8, hdlr.dataStart + 12) !== "vide") continue;

    const tkhd = findChild(buffer, track, "tkhd");
    if (!tkhd) continue;
    const version = buffer.readUInt8(tkhd.dataStart);
    const dimensionOffset = tkhd.dataStart + (version === 1 ? 88 : 76);
    const width = Math.round(buffer.readUInt32BE(dimensionOffset) / 65536);
    const height = Math.round(buffer.readUInt32BE(dimensionOffset + 4) / 65536);
    if (width > 0 && height > 0) return { width, height, durationSeconds };
  }

  throw new Error(`Could not find a video track in ${filePath}`);
}

export async function inspectMedia(filePath) {
  if (!existsSync(filePath)) throw new Error(`Missing media file: ${filePath}`);
  const extension = path.extname(filePath).toLowerCase().slice(1);
  const fileStat = await stat(filePath);
  const sha256 = await sha256File(filePath);

  if (extension === "mp4") {
    return {
      kind: "video",
      sourceExtension: extension,
      bytes: fileStat.size,
      sha256,
      hasTransparency: false,
      ...parseMp4Metadata(filePath),
    };
  }

  const { default: sharp } = await import("sharp");
  const metadata = await sharp(filePath, { failOn: "warning" }).metadata();
  if (!metadata.width || !metadata.height) throw new Error(`Missing image dimensions: ${filePath}`);
  const swapsAxes = metadata.orientation && metadata.orientation >= 5 && metadata.orientation <= 8;
  let hasTransparency = false;
  if (metadata.hasAlpha) {
    const imageStats = await sharp(filePath, { failOn: "warning" }).stats();
    const alphaChannel = imageStats.channels.at(-1);
    hasTransparency = Boolean(alphaChannel && alphaChannel.min < 255);
  }

  return {
    kind: "image",
    sourceExtension: extension === "jpeg" ? "jpg" : extension,
    width: swapsAxes ? metadata.height : metadata.width,
    height: swapsAxes ? metadata.width : metadata.height,
    bytes: fileStat.size,
    sha256,
    hasTransparency,
  };
}

export function contentTypeForKey(key) {
  const extension = path.extname(key).toLowerCase();
  return {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".mp4": "video/mp4",
  }[extension] ?? "application/octet-stream";
}

export function quotePowerShell(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}
