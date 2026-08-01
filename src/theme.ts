// Theme mode lives in its own storage key rather than inside AppSettings,
// because AppSettings is spread straight into the summarize request body and the
// backend contract has no room for a UI preference.

export const THEME_KEY = "youtube-distilled-theme"

export type ThemeMode = "system" | "light" | "dark"
export type ResolvedTheme = "light" | "dark"

// Cycle order for the header button. System comes first so the default sits at
// the top of the rotation.
const THEME_CYCLE: ThemeMode[] = ["system", "light", "dark"]

const THEME_COLORS: Record<ResolvedTheme, string> = {
  light: "#ffffff",
  dark: "#1e1e1e",
}

// Greyscale, matching the brief around it. Mermaid bakes these into the SVG it
// returns, so a theme change has to re-render rather than just restyle. The
// panel keeps its own copy in extension/diagrams.js; tests/diagrams.test.ts
// asserts the two against each other.
export const DIAGRAM_THEME_VARIABLES: Record<ResolvedTheme, Record<string, string>> = {
  light: {
    background: "#ffffff",
    primaryColor: "#f4f4f4",
    primaryTextColor: "#000000",
    primaryBorderColor: "rgba(0, 0, 0, 0.18)",
    secondaryColor: "#ffffff",
    tertiaryColor: "#fafafa",
    lineColor: "rgba(0, 0, 0, 0.35)",
    textColor: "rgba(0, 0, 0, 0.78)",
    fontSize: "13px",
  },
  dark: {
    background: "#1e1e1e",
    primaryColor: "#2b2b2b",
    primaryTextColor: "#f5f5f5",
    primaryBorderColor: "rgba(255, 255, 255, 0.22)",
    secondaryColor: "#1e1e1e",
    tertiaryColor: "#252525",
    lineColor: "rgba(255, 255, 255, 0.4)",
    textColor: "rgba(255, 255, 255, 0.8)",
    fontSize: "13px",
  },
}

export const DARK_MEDIA_QUERY = "(prefers-color-scheme: dark)"

export function normalizeThemeMode(value: unknown): ThemeMode {
  return value === "light" || value === "dark" ? value : "system"
}

export function nextThemeMode(mode: ThemeMode): ThemeMode {
  const index = THEME_CYCLE.indexOf(normalizeThemeMode(mode))
  return THEME_CYCLE[(index + 1) % THEME_CYCLE.length]
}

export function resolveTheme(mode: ThemeMode, systemPrefersDark: boolean): ResolvedTheme {
  if (mode === "system") return systemPrefersDark ? "dark" : "light"
  return mode
}

export function loadThemeMode(): ThemeMode {
  try {
    return normalizeThemeMode(window.localStorage.getItem(THEME_KEY))
  } catch {
    return "system"
  }
}

export function saveThemeMode(mode: ThemeMode) {
  try {
    window.localStorage.setItem(THEME_KEY, mode)
  } catch {
    // Private browsing can refuse writes. The theme still applies for this session.
  }
}

export function systemPrefersDark() {
  return window.matchMedia(DARK_MEDIA_QUERY).matches
}

// The inline script in index.html does this once before first paint; this keeps
// it in sync afterwards.
export function applyTheme(resolved: ResolvedTheme) {
  document.documentElement.classList.toggle("dark", resolved === "dark")
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLORS[resolved])
}
