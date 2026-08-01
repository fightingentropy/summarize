import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const target =
  process.platform === "darwin" && process.arch === "arm64"
    ? "macos-arm64"
    : process.platform === "linux" && process.arch === "x64"
      ? "linux-x64"
      : null;

function makeFixture({ symlink }: { symlink: boolean }) {
  if (!target) throw new Error("unsupported test platform");
  const root = mkdtempSync(path.join(tmpdir(), "summarize-installer-test-"));
  const fixtures = path.join(root, "fixtures");
  const stage = path.join(root, "stage");
  const bin = path.join(root, "bin");
  const installDir = path.join(root, "install");
  mkdirSync(fixtures);
  mkdirSync(stage);
  mkdirSync(bin);
  mkdirSync(installDir);

  const stagedBinary = path.join(stage, "summarize");
  if (symlink) {
    symlinkSync("/etc/passwd", stagedBinary);
  } else {
    writeFileSync(stagedBinary, "#!/usr/bin/env sh\necho safe\n", { mode: 0o755 });
  }

  const archiveName = `summarize-${target}-v9.9.9.tar.gz`;
  const archivePath = path.join(fixtures, archiveName);
  const tar = spawnSync("tar", ["-czf", archivePath, "-C", stage, "summarize"], {
    encoding: "utf8",
  });
  if (tar.status !== 0) throw new Error(tar.stderr);
  const digest = createHash("sha256").update(readFileSync(archivePath)).digest("hex");
  writeFileSync(`${archivePath}.sha256`, `${digest}  ${archiveName}\n`);

  const curlPath = path.join(bin, "curl");
  writeFileSync(
    curlPath,
    '#!/usr/bin/env bash\nset -euo pipefail\nurl="${@: -1}"\nname="${url##*/}"\nexec /bin/cat "$FIXTURE_DIR/$name"\n',
  );
  chmodSync(curlPath, 0o755);
  return { root, fixtures, bin, installDir };
}

function runInstaller(fixture: ReturnType<typeof makeFixture>) {
  return spawnSync("bash", ["scripts/install.sh"], {
    cwd: path.resolve(import.meta.dirname, ".."),
    encoding: "utf8",
    env: {
      ...process.env,
      FIXTURE_DIR: fixture.fixtures,
      HOME: fixture.root,
      PATH: `${fixture.bin}:${process.env.PATH ?? "/usr/bin:/bin"}`,
      SUMMARIZE_GITHUB_REPO: "example/summarize",
      SUMMARIZE_INSTALL_DIR: fixture.installDir,
      SUMMARIZE_RELEASE_BASE_URL: "https://fixtures.invalid",
      SUMMARIZE_VERSION: "v9.9.9",
    },
  });
}

describe.skipIf(!target)("release installer archive safety", () => {
  it("installs an archive containing one regular root binary", () => {
    const fixture = makeFixture({ symlink: false });
    const result = runInstaller(fixture);
    expect(result.status, result.stderr).toBe(0);
    expect(existsSync(path.join(fixture.installDir, "summarize"))).toBe(true);
  });

  it("rejects a link entry before extraction", () => {
    const fixture = makeFixture({ symlink: true });
    const result = runInstaller(fixture);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("must be a regular file");
    expect(existsSync(path.join(fixture.installDir, "summarize"))).toBe(false);
  });
});
