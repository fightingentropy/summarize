import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";

export function parseDotenv(text: string): Record<string, string> {
  const out: Record<string, string> = {};

  for (const rawLine of text.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    let line = trimmed;
    if (line.startsWith("export ")) line = line.slice("export ".length).trim();

    const equalsIndex = line.indexOf("=");
    if (equalsIndex <= 0) continue;

    const key = line.slice(0, equalsIndex).trim();
    if (!key) continue;

    let value = line.slice(equalsIndex + 1).trim();

    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.endsWith(quote) && value.length >= 2) {
      value = value.slice(1, -1);
    } else {
      const commentIndex = value.search(/\s+#/);
      if (commentIndex !== -1) value = value.slice(0, commentIndex).trimEnd();
    }

    out[key] = value;
  }

  return out;
}

export async function readDotenvFile(path: string): Promise<Record<string, string>> {
  try {
    const text = await readFile(path, "utf8");
    return parseDotenv(text);
  } catch {
    return {};
  }
}

export function readDotenvFileSync(path: string): Record<string, string> {
  try {
    const text = readFileSync(path, "utf8");
    return parseDotenv(text);
  } catch {
    return {};
  }
}

function formatDotenvValue(value: string): string {
  return /^[A-Za-z0-9_./:@-]+$/.test(value) ? value : JSON.stringify(value);
}

export function stringifyDotenv({
  entries,
  headerLines = [],
}: {
  entries: Record<string, string>;
  headerLines?: string[];
}): string {
  const lines = [...headerLines.map((line) => `# ${line}`)];
  for (const [key, value] of Object.entries(entries)) {
    lines.push(`${key}=${formatDotenvValue(value)}`);
  }
  return `${lines.join("\n")}\n`;
}
