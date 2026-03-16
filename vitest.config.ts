import { cpus } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const rootDir = dirname(fileURLToPath(import.meta.url));
const cpuCount = Math.max(1, cpus().length);
const envMaxThreads = Number.parseInt(process.env.VITEST_MAX_THREADS ?? "", 10);
const maxThreads = Number.isFinite(envMaxThreads)
  ? envMaxThreads
  : Math.min(8, Math.max(4, Math.floor(cpuCount / 2)));
const coverageReporters = process.env.CI
  ? ["text", "json-summary", "html"]
  : ["text", "json-summary"];

export default defineConfig({
  poolOptions: {
    threads: {
      minThreads: 1,
      maxThreads,
    },
  },
  resolve: {
    alias: [
      {
        find: /^summarize\/content$/,
        replacement: resolve(rootDir, "src/content/index.ts"),
      },
      {
        find: /^summarize\/content\/url$/,
        replacement: resolve(rootDir, "src/content/url.ts"),
      },
      {
        find: /^summarize\/prompts$/,
        replacement: resolve(rootDir, "src/prompts/index.ts"),
      },
      {
        find: /^summarize\/language$/,
        replacement: resolve(rootDir, "src/language.ts"),
      },
      {
        find: /^summarize\/processes$/,
        replacement: resolve(rootDir, "src/processes.ts"),
      },
      {
        find: /^summarize$/,
        replacement: resolve(rootDir, "src/index.ts"),
      },
    ],
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    hookTimeout: 15_000,
    testTimeout: 15_000,
    coverage: {
      provider: "v8",
      reporter: coverageReporters,
      include: ["src/**/*.ts"],
      exclude: [
        "**/*.d.ts",
        "**/dist/**",
        "**/node_modules/**",
        "tests/**",
        // Daemon is integration-tested / manually tested; unit coverage is noisy + brittle.
        "**/src/daemon/**",
        // Slide extraction is integration-tested; unit coverage is too noisy.
        "src/slides/extract.ts",
        // OS/browser integration (exec/sqlite/keychain); covered via higher-level tests.
        "**/src/content/transcript/providers/twitter-cookies-*.ts",
        // Barrels / type-only entrypoints (noise for coverage).
        "src/**/index.ts",
        "src/**/types.ts",
        "src/**/deps.ts",
      ],
      thresholds: {
        branches: 75,
        functions: 75,
        lines: 75,
        statements: 75,
      },
    },
  },
});
