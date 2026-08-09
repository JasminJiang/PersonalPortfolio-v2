import { mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { launch } from "chrome-launcher";
import lighthouse from "lighthouse";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const reportsRoot = path.join(repositoryRoot, ".lighthouse-reports");
const chromeProfile = path.join(reportsRoot, "chrome-profile");
const astroCli = path.join(repositoryRoot, "node_modules", "astro", "bin", "astro.mjs");
const host = "127.0.0.1";
const port = 4322;
const originArgumentIndex = process.argv.indexOf("--origin");
const configuredOrigin = originArgumentIndex >= 0 ? process.argv[originArgumentIndex + 1] : undefined;
if (originArgumentIndex >= 0 && !configuredOrigin) throw new Error("--origin requires an HTTP(S) URL");
const targetOrigin = configuredOrigin ? new URL(configuredOrigin) : new URL(`http://${host}:${port}`);
if (!['http:', 'https:'].includes(targetOrigin.protocol)) throw new Error("--origin must use HTTP or HTTPS");
targetOrigin.pathname = targetOrigin.pathname.replace(/\/+$/, "");
targetOrigin.search = "";
targetOrigin.hash = "";
const origin = targetOrigin.toString().replace(/\/$/, "");
const usesLocalPreview = configuredOrigin === undefined;
const targets = [
  { name: "home", path: "/", performance: 0.8, runs: 3 },
  { name: "project", path: "/projects/aeolian-resonance/", performance: 0.9, runs: 3 },
];

const diagnosticAudits = [
  "first-contentful-paint",
  "largest-contentful-paint",
  "speed-index",
  "total-blocking-time",
  "cumulative-layout-shift",
];

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const midpoint = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[midpoint - 1] + sorted[midpoint]) / 2
    : sorted[midpoint];
}

async function waitForServer() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(origin);
      if (response.ok) return response;
    } catch {
      // The preview process may still be binding its socket.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Astro preview did not become ready at ${origin}`);
}

function runAstro(arguments_, { allowFailure = false } = {}) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const child = spawn(process.execPath, [astroCli, ...arguments_], {
      cwd: repositoryRoot,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (chunk) => chunks.push(chunk));
    child.stderr.on("data", (chunk) => chunks.push(chunk));
    child.on("error", reject);
    child.on("exit", (code) => {
      const output = Buffer.concat(chunks).toString("utf8");
      if (code === 0 || allowFailure) resolve(output);
      else reject(new Error(`Astro CLI exited with ${code}:\n${output}`));
    });
  });
}

async function stopChrome(chrome) {
  if (!chrome) return;
  if (process.platform !== "win32") {
    await chrome.kill();
    return;
  }

  const killer = spawn("taskkill.exe", ["/PID", String(chrome.pid), "/T", "/F"], {
    windowsHide: true,
    stdio: "ignore",
  });
  let timeout;
  const status = await Promise.race([
    new Promise((resolve) => {
      killer.once("error", () => resolve(null));
      killer.once("exit", resolve);
    }),
    new Promise((resolve) => {
      timeout = setTimeout(() => {
        killer.kill();
        resolve(null);
      }, 10_000);
    }),
  ]);
  clearTimeout(timeout);
  chrome.process.removeAllListeners();
  chrome.process.unref();
  let stillRunning = false;
  try {
    process.kill(chrome.pid, 0);
    stillRunning = true;
  } catch {
    // The browser already exited cleanly.
  }
  if (status !== 0 && stillRunning) {
    process.stderr.write(`Chrome cleanup warning: taskkill exited with ${status}\n`);
  }
}

await mkdir(reportsRoot, { recursive: true });
await mkdir(chromeProfile, { recursive: true });
if (usesLocalPreview) {
  await runAstro(["preview", "--background", "--host", host, "--port", String(port)]);
}

let chrome;
try {
  const entryResponse = await waitForServer();
  const robotsHeader = entryResponse.headers.get("x-robots-tag") ?? "";
  const previewNoIndex = /(?:^|[,\s])noindex(?:$|[,\s])/i.test(robotsHeader);
  if (previewNoIndex) {
    process.stdout.write(
      "Origin returns X-Robots-Tag: noindex; recording SEO scores without enforcing the production SEO threshold.\n",
    );
  }
  chrome = await launch({
    chromePath: chromium.executablePath(),
    userDataDir: chromeProfile,
    chromeFlags: ["--headless=new", "--no-sandbox", "--disable-dev-shm-usage"],
  });

  const failures = [];
  for (const target of targets) {
    const results = [];
    for (let run = 1; run <= target.runs; run += 1) {
      const result = await lighthouse(`${origin}${target.path}`, {
        port: chrome.port,
        output: "json",
        logLevel: "error",
        onlyCategories: ["performance", "accessibility", "best-practices", "seo"],
      });
      if (!result) throw new Error(`Lighthouse returned no result for ${target.path}`);
      const scores = Object.fromEntries(
        Object.entries(result.lhr.categories).map(([id, category]) => [id, category.score ?? 0]),
      );
      const diagnostics = Object.fromEntries(
        diagnosticAudits.map((id) => [id, result.lhr.audits[id]?.numericValue ?? null]),
      );
      results.push({ scores, diagnostics });
      await writeFile(path.join(reportsRoot, `${target.name}-${run}.json`), result.report, "utf8");
      process.stdout.write(
        `${target.name} run ${run}/${target.runs}: ${JSON.stringify({ scores, diagnostics })}\n`,
      );
    }

    const categoryNames = Object.keys(results[0].scores);
    const scores = Object.fromEntries(
      categoryNames.map((category) => [
        category,
        median(results.map((result) => result.scores[category] ?? 0)),
      ]),
    );
    const thresholds = {
      performance: target.performance,
      accessibility: 0.95,
      "best-practices": 0.95,
      ...(!previewNoIndex && { seo: 0.95 }),
    };
    for (const [category, threshold] of Object.entries(thresholds)) {
      if ((scores[category] ?? 0) < threshold) {
        failures.push(`${target.name} ${category}: ${scores[category]} < ${threshold}`);
      }
    }
    process.stdout.write(`${target.name} median: ${JSON.stringify(scores)}\n`);
  }

  if (failures.length) throw new Error(`Lighthouse thresholds failed:\n${failures.join("\n")}`);
} finally {
  try {
    await stopChrome(chrome);
  } catch (error) {
    process.stderr.write(`Chrome cleanup warning: ${error instanceof Error ? error.message : String(error)}\n`);
  }
  if (usesLocalPreview) {
    await runAstro(["preview", "stop", "--port", String(port)], { allowFailure: true });
  }
}
