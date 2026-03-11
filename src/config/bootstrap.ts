import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { buildDefaultSummarizeConfig, DEFAULT_CONFIG_SECRET_ENV_KEYS } from "./defaults.js";
import { readDotenvFileSync, stringifyDotenv } from "./dotenv.js";
import { LEGACY_API_KEY_ENV_MAP } from "./env.js";
import { isRecord } from "./parse-helpers.js";
import {
  readParsedConfigFile,
  resolveSummarizeConfigPath,
  resolveSummarizeSecretsPath,
} from "./read.js";

const SECRET_ENV_KEY_SET = new Set<string>([
  ...DEFAULT_CONFIG_SECRET_ENV_KEYS,
  ...Object.values(LEGACY_API_KEY_ENV_MAP),
]);

function cloneJsonValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function mergeDefaults(defaultValue: unknown, currentValue: unknown): unknown {
  if (typeof currentValue === "undefined") return cloneJsonValue(defaultValue);
  if (!isRecord(defaultValue) || !isRecord(currentValue)) return cloneJsonValue(currentValue);

  const merged: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(defaultValue)) {
    merged[key] = mergeDefaults(value, currentValue[key]);
  }
  for (const [key, value] of Object.entries(currentValue)) {
    if (key in merged) continue;
    merged[key] = cloneJsonValue(value);
  }
  return merged;
}

function orderEnvEntries(envValue: unknown): unknown {
  if (!isRecord(envValue)) return envValue;
  const ordered: Record<string, unknown> = {};
  for (const key of DEFAULT_CONFIG_SECRET_ENV_KEYS) {
    if (key in envValue) ordered[key] = envValue[key];
  }
  for (const [key, value] of Object.entries(envValue)) {
    if (key in ordered) continue;
    ordered[key] = value;
  }
  return ordered;
}

function sanitizeConfigSecrets(root: Record<string, unknown>): {
  sanitizedRoot: Record<string, unknown>;
  migratedEnv: Record<string, string>;
} {
  const sanitizedRoot = cloneJsonValue(root);
  const migratedEnv: Record<string, string> = {};

  if (isRecord(sanitizedRoot.env)) {
    const nextEnv: Record<string, unknown> = {};
    for (const [rawKey, rawValue] of Object.entries(sanitizedRoot.env)) {
      const key = rawKey.trim();
      if (
        SECRET_ENV_KEY_SET.has(key) &&
        typeof rawValue === "string" &&
        rawValue.trim().length > 0
      ) {
        migratedEnv[key] = rawValue;
        continue;
      }
      nextEnv[key] = rawValue;
    }
    if (Object.keys(nextEnv).length > 0) sanitizedRoot.env = nextEnv;
    else delete sanitizedRoot.env;
  }

  if (isRecord(sanitizedRoot.apiKeys)) {
    for (const [rawKey, rawValue] of Object.entries(sanitizedRoot.apiKeys)) {
      const normalizedKey = rawKey.trim().toLowerCase() as keyof typeof LEGACY_API_KEY_ENV_MAP;
      const mappedKey = LEGACY_API_KEY_ENV_MAP[normalizedKey];
      if (!mappedKey) continue;
      if (typeof rawValue === "string" && rawValue.trim().length > 0) {
        migratedEnv[mappedKey] = rawValue.trim();
      }
    }
    delete sanitizedRoot.apiKeys;
  }

  return { sanitizedRoot, migratedEnv };
}

function normalizeLegacyConfigShape(root: Record<string, unknown>): Record<string, unknown> {
  const normalizedRoot = cloneJsonValue(root);
  const legacyLanguage =
    typeof normalizedRoot.language === "string" ? normalizedRoot.language.trim() : "";
  if (legacyLanguage.length > 0) {
    if (typeof normalizedRoot.output === "undefined") {
      normalizedRoot.output = { language: legacyLanguage };
    } else if (isRecord(normalizedRoot.output)) {
      const output = { ...normalizedRoot.output };
      if (!(typeof output.language === "string" && output.language.trim().length > 0)) {
        output.language = legacyLanguage;
      }
      normalizedRoot.output = output;
    }
  }
  delete normalizedRoot.language;
  return normalizedRoot;
}

function writeTextFileIfChanged(path: string, next: string): void {
  const current = existsSync(path) ? readFileSync(path, "utf8") : null;
  if (current === next) return;
  mkdirSync(dirname(path), { recursive: true });
  const tmpPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmpPath, next, "utf8");
  renameSync(tmpPath, path);
}

function writeMigratedSecrets({
  env,
  migratedEnv,
}: {
  env: Record<string, string | undefined>;
  migratedEnv: Record<string, string>;
}): void {
  const secretsPath = resolveSummarizeSecretsPath(env);
  if (!secretsPath || Object.keys(migratedEnv).length === 0) return;

  const currentEnv = readDotenvFileSync(secretsPath);
  let changed = false;
  const nextEnv = { ...currentEnv };
  for (const [key, value] of Object.entries(migratedEnv)) {
    const existing = nextEnv[key];
    if (typeof existing === "string" && existing.trim().length > 0) continue;
    nextEnv[key] = value;
    changed = true;
  }
  if (!changed) return;

  const ordered: Record<string, string> = {};
  for (const key of DEFAULT_CONFIG_SECRET_ENV_KEYS) {
    const value = nextEnv[key];
    if (typeof value === "string" && value.trim().length > 0) ordered[key] = value;
  }
  for (const [key, value] of Object.entries(nextEnv)) {
    if (key in ordered) continue;
    ordered[key] = value;
  }

  writeTextFileIfChanged(
    secretsPath,
    stringifyDotenv({
      entries: ordered,
      headerLines: [
        "Local summarize credentials. Keep this file on your machine; do not commit API key values.",
      ],
    }),
  );
}

export function ensureSummarizeUserFiles({ env }: { env: Record<string, string | undefined> }): {
  configPath: string | null;
  secretsPath: string | null;
} {
  const configPath = resolveSummarizeConfigPath(env);
  const secretsPath = resolveSummarizeSecretsPath(env);
  if (!configPath) return { configPath: null, secretsPath };

  const current = readParsedConfigFile(configPath) ?? {};
  const { sanitizedRoot, migratedEnv } = sanitizeConfigSecrets(current);
  const normalizedRoot = normalizeLegacyConfigShape(sanitizedRoot);
  const merged = mergeDefaults(buildDefaultSummarizeConfig(), normalizedRoot) as Record<
    string,
    unknown
  >;
  if ("env" in merged) merged.env = orderEnvEntries(merged.env);
  writeTextFileIfChanged(configPath, `${JSON.stringify(merged, null, 2)}\n`);
  writeMigratedSecrets({ env, migratedEnv });
  return { configPath, secretsPath };
}

export function loadSummarizeLocalEnv({
  env,
}: {
  env: Record<string, string | undefined>;
}): Record<string, string> {
  const secretsPath = resolveSummarizeSecretsPath(env);
  return secretsPath ? readDotenvFileSync(secretsPath) : {};
}
