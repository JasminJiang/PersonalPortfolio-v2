import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const git = process.platform === "win32" ? "git.exe" : "git";
const forbiddenText = [
  "@" + "google/genai",
  "Ge" + "mini",
  "AI " + "Studio",
  "fonts." + "google" + "apis" + ".com",
  "fonts." + "gstatic" + ".com",
  "google" + "apis" + ".com",
  "unpkg" + ".com",
  "version https://git-" + "lfs.github.com/spec/v1",
];
const credentialPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bgh[opsu]_[A-Za-z0-9_]{20,}\b/,
  /\b(?:api[_-]?key|api[_-]?token|account[_-]?token)\s*[:=]\s*["'][^"']{12,}["']/i,
];
const binaryMedia = /\.(?:avif|gif|jpe?g|mov|mp4|png|webm|webp)$/i;

function run(args, { allowFailure = false } = {}) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const child = spawn(git, ["-c", `safe.directory=${repositoryRoot}`, ...args], {
      cwd: repositoryRoot,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (chunk) => chunks.push(chunk));
    child.stderr.on("data", (chunk) => chunks.push(chunk));
    child.on("error", reject);
    child.on("exit", (code) => {
      const output = Buffer.concat(chunks).toString("utf8");
      if (code === 0 || allowFailure) resolve({ code, output });
      else reject(new Error(`git ${args.join(" ")} exited with ${code}\n${output}`));
    });
  });
}

function lines(value) {
  return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function inspectText(label, content, failures) {
  for (const term of forbiddenText) {
    if (content.toLowerCase().includes(term.toLowerCase())) failures.push(`${label}: forbidden text ${term}`);
  }
  for (const pattern of credentialPatterns) {
    if (pattern.test(content)) failures.push(`${label}: possible credential matching ${pattern}`);
  }
}

function inspectPaths(label, paths, failures) {
  for (const file of paths) {
    if (binaryMedia.test(file)) failures.push(`${label}: tracked media binary ${file}`);
    if (/^\.env(?:\.|$)/i.test(file) && file !== ".env.example") failures.push(`${label}: environment file ${file}`);
  }
}

const failures = [];
const workspaceFiles = lines((await run(["ls-files", "--cached", "--others", "--exclude-standard"])).output);
inspectPaths("workspace", workspaceFiles, failures);

for (const file of workspaceFiles) {
  let content;
  try {
    content = await readFile(path.join(repositoryRoot, file));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") continue;
    throw error;
  }
  if (content.includes(0)) continue;
  inspectText(`workspace:${file}`, content.toString("utf8"), failures);
}

const commits = lines((await run(["rev-list", "--all"])).output);
for (const commit of commits) {
  const treeFiles = lines((await run(["ls-tree", "-r", "--name-only", commit])).output);
  inspectPaths(`commit:${commit}`, treeFiles, failures);
  for (const file of treeFiles) {
    const result = await run(["show", `${commit}:${file}`], { allowFailure: true });
    if (result.code !== 0 || result.output.includes("Binary files")) continue;
    inspectText(`commit:${commit}:${file}`, result.output, failures);
  }
}

if (failures.length) {
  throw new Error(`Repository audit failed:\n${failures.join("\n")}`);
}

process.stdout.write(`Repository audit passed for ${workspaceFiles.length} workspace files and ${commits.length} commits.\n`);
