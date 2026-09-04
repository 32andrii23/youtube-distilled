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
export const DIAGRAM_THEME_VARIABLES: Record<ResolvedTheme, Record<string, unknown>> = {
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
    // An xychart takes none of its colour from the variables above: it paints
    // its own background and draws from its own pastel palette. Left alone it
    // puts a near-invisible yellow line on white, and in a dark brief it puts a
    // white chart with white-on-white axis labels in the middle of the page.
    xyChart: {
      backgroundColor: "#ffffff",
      titleColor: "#000000",
      plotColorPalette: "#3d3d3d,#7a7a7a,#b3b3b3",
      xAxisLabelColor: "rgba(0, 0, 0, 0.78)",
      xAxisTitleColor: "rgba(0, 0, 0, 0.78)",
      xAxisLineColor: "rgba(0, 0, 0, 0.35)",
      xAxisTickColor: "rgba(0, 0, 0, 0.35)",
      yAxisLabelColor: "rgba(0, 0, 0, 0.78)",
      yAxisTitleColor: "rgba(0, 0, 0, 0.78)",
      yAxisLineColor: "rgba(0, 0, 0, 0.35)",
      yAxisTickColor: "rgba(0, 0, 0, 0.35)",
    },
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
    xyChart: {
      backgroundColor: "#1e1e1e",
      titleColor: "#f5f5f5",
      plotColorPalette: "#e6e6e6,#a3a3a3,#6e6e6e",
      xAxisLabelColor: "rgba(255, 255, 255, 0.8)",
      xAxisTitleColor: "rgba(255, 255, 255, 0.8)",
      xAxisLineColor: "rgba(255, 255, 255, 0.4)",
      xAxisTickColor: "rgba(255, 255, 255, 0.4)",
      yAxisLabelColor: "rgba(255, 255, 255, 0.8)",
      yAxisTitleColor: "rgba(255, 255, 255, 0.8)",
      yAxisLineColor: "rgba(255, 255, 255, 0.4)",
      yAxisTickColor: "rgba(255, 255, 255, 0.4)",
    },
  },
}

// Mermaid config, as opposed to theme variables, that both surfaces need. Keyed
// by theme because the one thing in it is a colour.
export const DIAGRAM_CONFIG = {
  // A sankey draws its ribbons as a colour gradient between the two ends, which
  // is the only colour left in an otherwise greyscale brief. The node bars carry
  // a fill attribute rather than a config value, so the stylesheets grey those.
  light: { sankey: { linkColor: "#c4c4c4" } },
  dark: { sankey: { linkColor: "#4a4a4a" } },
}

// Mermaid's own name for each type the analysis may draw, which is not always
// the name the diagram opens with: a `stateDiagram-v2` is configured as `state`
// and an `xychart-beta` as `xyChart`. tests/diagrams.test.ts checks this against
// the types backend/prompt.py offers.
export const DIAGRAM_TYPE_KEYS = [
  "flowchart",
  "mindmap",
  "state",
  "sequence",
  "quadrantChart",
  "er",
  "timeline",
  "sankey",
  "xyChart",
]

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
