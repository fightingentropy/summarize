import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactDir = path.resolve(projectRoot, process.argv[2] ?? "dist-bun");
const pkg = JSON.parse(readFileSync(path.join(projectRoot, "package.json"), "utf8")) as {
  version?: unknown;
};

if (typeof pkg.version !== "string" || pkg.version.length === 0) {
  throw new Error("package.json version is missing");
}

const targets = ["macos-arm64", "linux-x64"] as const;
const MAX_ARCHIVE_BYTES = 256 * 1024 * 1024;

async function sha256(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return hash.digest("hex");
}

function runTar(args: string[]): string {
  const result = spawnSync("tar", args, {
    cwd: projectRoot,
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`tar ${args.join(" ")} failed: ${result.stderr.trim()}`);
  }
  return result.stdout;
}

for (const target of targets) {
  const basename = `summarize-${target}-v${pkg.version}.tar.gz`;
  const archivePath = path.join(artifactDir, basename);
  const checksumPath = `${archivePath}.sha256`;
  const archiveStat = statSync(archivePath);
  if (!archiveStat.isFile() || archiveStat.size <= 0 || archiveStat.size > MAX_ARCHIVE_BYTES) {
    throw new Error(`${basename} is not a bounded regular archive`);
  }

  const entries = runTar(["-tzf", archivePath])
    .split(/\r?\n/)
    .filter((entry) => entry.length > 0);
  if (entries.length !== 1 || entries[0] !== "summarize") {
    throw new Error(`${basename} must contain exactly one root entry named summarize`);
  }

  const verboseEntries = runTar(["-tvzf", archivePath])
    .split(/\r?\n/)
    .filter((entry) => entry.length > 0);
  if (verboseEntries.length !== 1 || !verboseEntries[0]?.startsWith("-")) {
    throw new Error(`${basename} must contain a regular file, not a link or special entry`);
  }
  if (!verboseEntries[0]?.slice(0, 10).includes("x")) {
    throw new Error(`${basename} summarize entry is not executable`);
  }

  const checksumLine = readFileSync(checksumPath, "utf8").trim();
  const match = /^([a-f0-9]{64})\s{2}([^\s]+)$/.exec(checksumLine);
  if (!match || match[2] !== basename) {
    throw new Error(`${path.basename(checksumPath)} has an invalid checksum record`);
  }
  const actual = await sha256(archivePath);
  if (match[1] !== actual) {
    throw new Error(`${basename} checksum mismatch`);
  }
  console.log(`validated ${basename}`);
}
