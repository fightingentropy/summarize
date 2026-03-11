import { execFileSync, execSync } from "node:child_process";
import { chmod, copyFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

const distDir = path.join(repoRoot, "dist");
const slidesDistDir = path.join(distDir, "esm", "slides");
await mkdir(distDir, { recursive: true });
await mkdir(slidesDistDir, { recursive: true });

const gitSha = (() => {
  try {
    return execSync("git rev-parse --short=8 HEAD", { cwd: repoRoot, encoding: "utf8" }).trim();
  } catch {
    return "";
  }
})();

// ESM binary wrapper.
// Avoid bundling: CJS deps (e.g. commander) can trigger esbuild's dynamic-require shim in ESM output.
const wrapper = `#!/usr/bin/env node
${gitSha ? `if (!process.env.SUMMARIZE_GIT_SHA) process.env.SUMMARIZE_GIT_SHA = ${JSON.stringify(gitSha)}\n` : ""}await import('./esm/cli.js')
`;

await writeFile(path.join(distDir, "cli.js"), wrapper, "utf8");
await chmod(path.join(distDir, "cli.js"), 0o755);
const visionHelperSourcePath = path.join(repoRoot, "src", "slides", "vision-ocr-helper.swift");
await copyFile(visionHelperSourcePath, path.join(slidesDistDir, "vision-ocr-helper.swift"));

if (process.platform === "darwin") {
  const swiftcPath = process.env.SUMMARIZE_SWIFTC_PATH?.trim() || "swiftc";
  const bundledHelperPath = path.join(slidesDistDir, `vision-ocr-helper-${process.arch}`);
  try {
    execFileSync(swiftcPath, [visionHelperSourcePath, "-O", "-o", bundledHelperPath], {
      cwd: repoRoot,
      stdio: "inherit",
    });
    await chmod(bundledHelperPath, 0o755);
  } catch (error) {
    const errorCode =
      typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
    if (errorCode === "ENOENT") {
      console.warn(
        `[build:cli] Skipping bundled Vision OCR helper: swiftc not found (${swiftcPath}).`,
      );
    } else {
      throw error;
    }
  }
}
