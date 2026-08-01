import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packagePath = path.join(projectRoot, "package.json");
const readmePath = path.join(projectRoot, "README.md");
const versionPath = path.join(projectRoot, "src", "version.ts");

const pkg = JSON.parse(readFileSync(packagePath, "utf8")) as { version?: unknown };
if (
  typeof pkg.version !== "string" ||
  !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(pkg.version)
) {
  throw new Error("package.json contains an invalid version");
}

function replaceExactlyOnce({
  source,
  pattern,
  replacement,
  label,
}: {
  source: string;
  pattern: RegExp;
  replacement: string;
  label: string;
}): string {
  const matches = Array.from(source.matchAll(pattern));
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one ${label}; found ${matches.length}`);
  }
  return source.replace(pattern, replacement);
}

const updates = [
  {
    path: readmePath,
    label: "README installer version",
    pattern: /SUMMARIZE_VERSION=v[0-9A-Za-z.+-]+/g,
    replacement: `SUMMARIZE_VERSION=v${pkg.version}`,
  },
  {
    path: versionPath,
    label: "runtime fallback version",
    pattern: /export const FALLBACK_VERSION = "[^"]+";/g,
    replacement: `export const FALLBACK_VERSION = "${pkg.version}";`,
  },
];

const mode = process.argv[2] ?? "--check";
if (mode !== "--check" && mode !== "--write") {
  throw new Error("Usage: sync-release-version.ts --check|--write");
}

let drifted = false;
for (const update of updates) {
  const current = readFileSync(update.path, "utf8");
  const expected = replaceExactlyOnce({
    source: current,
    pattern: update.pattern,
    replacement: update.replacement,
    label: update.label,
  });
  if (current === expected) continue;
  drifted = true;
  if (mode === "--write") {
    writeFileSync(update.path, expected);
    console.log(`updated ${path.relative(projectRoot, update.path)} to ${pkg.version}`);
  } else {
    console.error(`${path.relative(projectRoot, update.path)} is not synced to ${pkg.version}`);
  }
}

if (mode === "--check" && drifted) {
  console.error("Run bun run release:version:sync after changing package.json version.");
  process.exitCode = 1;
} else if (!drifted) {
  console.log(`release versions are synced at ${pkg.version}`);
}
