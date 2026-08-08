import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { contentTypeForKey, parseArgs, quotePowerShell, sourceFilePath } from "./lib/media-utils.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = parseArgs(process.argv.slice(2));
if (!args["legacy-root"]) throw new Error("Pass --legacy-root <path> to the private legacy checkout");

const legacyRoot = path.resolve(args["legacy-root"]);
const mediaRoot = path.resolve(args["media-root"] || path.join(repositoryRoot, ".media-work"));
const outputRoot = path.resolve(args.output || path.join(mediaRoot, "upload-plan"));
const manifest = JSON.parse(await readFile(path.join(repositoryRoot, "src", "data", "media-manifest.json"), "utf8"));
await mkdir(outputRoot, { recursive: true });

const originalCommands = [];
const webCommands = [];

for (const item of manifest.items) {
  const originalFile = sourceFilePath(legacyRoot, item.sourcePath);
  originalCommands.push(
    `npx wrangler r2 object put ${quotePowerShell(`${manifest.originalBucket}/${item.originalR2Key}`)} --file ${quotePowerShell(originalFile)} --content-type ${quotePowerShell(contentTypeForKey(item.originalR2Key))} --remote`,
  );

  for (const key of [item.webR2Key, item.posterR2Key].filter(Boolean)) {
    const webFile = path.join(mediaRoot, "web", ...key.split("/"));
    webCommands.push(
      `npx wrangler r2 object put ${quotePowerShell(`${manifest.webBucket}/${key}`)} --file ${quotePowerShell(webFile)} --content-type ${quotePowerShell(contentTypeForKey(key))} --cache-control ${quotePowerShell("public, max-age=31536000, immutable")} --remote`,
    );
  }
}

const preamble = [
  "$ErrorActionPreference = 'Stop'",
  "# Authenticate interactively with `npx wrangler login` before running this file.",
  "# No Cloudflare credentials are stored in this repository or upload plan.",
  "",
];

await writeFile(path.join(outputRoot, "upload-originals.ps1"), `${[...preamble, ...originalCommands].join("\n")}\n`, "utf8");
await writeFile(path.join(outputRoot, "upload-web.ps1"), `${[...preamble, ...webCommands].join("\n")}\n`, "utf8");
await writeFile(path.join(outputRoot, "upload-summary.json"), `${JSON.stringify({
  originalsBucket: manifest.originalBucket,
  originalsObjects: originalCommands.length,
  webBucket: manifest.webBucket,
  webObjects: webCommands.length,
}, null, 2)}\n`, "utf8");

process.stdout.write(`Created manual Wrangler upload plans under ${outputRoot}\n`);
