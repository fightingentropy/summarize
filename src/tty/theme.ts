type Rgb = { r: number; g: number; b: number };

export const CLI_THEME_NAMES = ["aurora", "ember", "moss", "mono"] as const;
export type CliThemeName = (typeof CLI_THEME_NAMES)[number];

export type ThemeRole =
  | "heading"
  | "accent"
  | "accentStrong"
  | "muted"
  | "dim"
  | "success"
  | "warning"
  | "error"
  | "label"
  | "value"
  | "code";

type ThemePalette = {
  name: CliThemeName;
  roles: Record<ThemeRole, string>;
  spinner: "cyan" | "magenta" | "yellow" | "green" | "gray" | "blue";
};

const THEMES: Record<CliThemeName, ThemePalette> = {
  aurora: {
    name: "aurora",
    roles: {
      heading: "#8be9fd",
      accent: "#38bdf8",
      accentStrong: "#7dd3fc",
      label: "#a5b4fc",
      value: "#e2e8f0",
      muted: "#94a3b8",
      dim: "#64748b",
      success: "#34d399",
      warning: "#fbbf24",
      error: "#fb7185",
      code: "#c4b5fd",
    },
    spinner: "cyan",
  },
  ember: {
    name: "ember",
    roles: {
      heading: "#fdba74",
      accent: "#f97316",
      accentStrong: "#fb923c",
      label: "#fed7aa",
      value: "#fff7ed",
      muted: "#cbd5e1",
      dim: "#94a3b8",
      success: "#84cc16",
      warning: "#f59e0b",
      error: "#f43f5e",
      code: "#f472b6",
    },
    spinner: "yellow",
  },
  moss: {
    name: "moss",
    roles: {
      heading: "#86efac",
      accent: "#22c55e",
      accentStrong: "#4ade80",
      label: "#a7f3d0",
      value: "#ecfdf5",
      muted: "#94a3b8",
      dim: "#64748b",
      success: "#16a34a",
      warning: "#facc15",
      error: "#fb7185",
      code: "#5eead4",
    },
    spinner: "green",
  },
  mono: {
    name: "mono",
    roles: {
      heading: "#e5e7eb",
      accent: "#d1d5db",
      accentStrong: "#f3f4f6",
      label: "#cbd5e1",
      value: "#f8fafc",
      muted: "#9ca3af",
      dim: "#6b7280",
      success: "#e5e7eb",
      warning: "#e5e7eb",
      error: "#f87171",
      code: "#c7d2fe",
    },
    spinner: "gray",
  },
};

export const DEFAULT_CLI_THEME: CliThemeName = "aurora";

export function listCliThemes(): CliThemeName[] {
  return [...CLI_THEME_NAMES];
}

export function isCliThemeName(value: string): value is CliThemeName {
  return CLI_THEME_NAMES.includes(value as CliThemeName);
}

export function parseCliThemeName(raw: unknown, label: string): CliThemeName | null {
  if (typeof raw === "undefined" || raw === null) return null;
  if (typeof raw !== "string") {
    throw new Error(`Unsupported ${label}: ${String(raw)}`);
  }
  const normalized = raw.trim().toLowerCase();
  if (!normalized) return null;
  if (isCliThemeName(normalized)) return normalized;
  throw new Error(`Unsupported ${label}: ${raw} (use ${CLI_THEME_NAMES.join(", ")})`);
}

export function resolveThemeNameFromSources({
  cli,
  env,
  config,
  fallback = DEFAULT_CLI_THEME,
}: {
  cli?: unknown;
  env?: unknown;
  config?: unknown;
  fallback?: CliThemeName;
}): CliThemeName {
  const cliName = parseCliThemeName(cli, "--theme");
  if (cliName) return cliName;
  const envName = parseCliThemeName(env, "SUMMARIZE_THEME");
  if (envName) return envName;
  const configName = parseCliThemeName(config, "ui.theme");
  if (configName) return configName;
  return fallback;
}

export function resolveTrueColor(env: Record<string, string | undefined>): boolean {
  const force = env.SUMMARIZE_TRUECOLOR?.trim().toLowerCase();
  if (force === "1" || force === "true" || force === "yes") return true;
  const disabled = env.SUMMARIZE_NO_TRUECOLOR?.trim().toLowerCase();
  if (disabled === "1" || disabled === "true" || disabled === "yes") return false;

  const colorterm = env.COLORTERM?.toLowerCase() ?? "";
  if (colorterm.includes("truecolor") || colorterm.includes("24bit")) return true;

  const termProgram = env.TERM_PROGRAM?.toLowerCase() ?? "";
  if (["iterm.app", "wezterm", "vscode", "apple_terminal", "hyper"].includes(termProgram)) {
    return true;
  }

  const term = env.TERM?.toLowerCase() ?? "";
  if (term.includes("256color") || term.includes("direct")) return true;

  return true;
}

const FALLBACK_CODES: Record<ThemeRole, string> = {
  heading: "1;36",
  accent: "36",
  accentStrong: "1;36",
  label: "36",
  value: "1",
  muted: "90",
  dim: "2",
  success: "1;32",
  warning: "1;33",
  error: "1;31",
  code: "35",
};

type ThemeRendererOptions = {
  themeName: CliThemeName;
  enabled: boolean;
  trueColor: boolean;
};

export type ThemeRenderer = {
  name: CliThemeName;
  enabled: boolean;
  trueColor: boolean;
  palette: ThemePalette;
  heading: (text: string) => string;
  accent: (text: string) => string;
  accentStrong: (text: string) => string;
  label: (text: string) => string;
  value: (text: string) => string;
  muted: (text: string) => string;
  dim: (text: string) => string;
  success: (text: string) => string;
  warning: (text: string) => string;
  error: (text: string) => string;
  code: (text: string) => string;
};

const ansi = (code: string, input: string, enabled: boolean): string => {
  if (!enabled) return input;
  return `\u001b[${code}m${input}\u001b[0m`;
};

const parseHex = (value: string): Rgb => {
  const hex = value.replace("#", "").trim();
  if (hex.length !== 6) return { r: 255, g: 255, b: 255 };
  const r = Number.parseInt(hex.slice(0, 2), 16);
  const g = Number.parseInt(hex.slice(2, 4), 16);
  const b = Number.parseInt(hex.slice(4, 6), 16);
  if ([r, g, b].some((c) => Number.isNaN(c))) return { r: 255, g: 255, b: 255 };
  return { r, g, b };
};

const ansiRgb = (rgb: Rgb, input: string, enabled: boolean, bold = false): string => {
  if (!enabled) return input;
  const codes = [bold ? "1" : null, `38;2;${rgb.r};${rgb.g};${rgb.b}`].filter(Boolean).join(";");
  return `\u001b[${codes}m${input}\u001b[0m`;
};

export function createThemeRenderer({
  themeName,
  enabled,
  trueColor,
}: ThemeRendererOptions): ThemeRenderer {
  const palette = THEMES[themeName] ?? THEMES[DEFAULT_CLI_THEME];

  const colorize = (role: ThemeRole, text: string, bold = false) => {
    if (!enabled) return text;
    if (trueColor) {
      return ansiRgb(parseHex(palette.roles[role]), text, enabled, bold);
    }
    return ansi(bold ? `1;${FALLBACK_CODES[role]}` : FALLBACK_CODES[role], text, enabled);
  };

  return {
    name: palette.name,
    enabled,
    trueColor,
    palette,
    heading: (text) => colorize("heading", text, true),
    accent: (text) => colorize("accent", text),
    accentStrong: (text) => colorize("accentStrong", text, true),
    label: (text) => colorize("label", text),
    value: (text) => colorize("value", text, true),
    muted: (text) => colorize("muted", text),
    dim: (text) => colorize("dim", text),
    success: (text) => colorize("success", text, true),
    warning: (text) => colorize("warning", text, true),
    error: (text) => colorize("error", text, true),
    code: (text) => colorize("code", text),
  };
}

export function resolveThemePalette(themeName: CliThemeName): ThemePalette {
  return THEMES[themeName] ?? THEMES[DEFAULT_CLI_THEME];
}
