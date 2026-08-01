// The panel's copy of the theme rules. Kept separate from src/theme.ts because
// the panel ships as plain ES modules with no build step, the same way
// markdown.js carries its own timecode handling. tests/theme.test.ts asserts
// both implementations against one table so they cannot drift.

export const THEME_KEY = "youtube-distilled-theme"

const THEME_CYCLE = ["system", "light", "dark"]

export const DARK_MEDIA_QUERY = "(prefers-color-scheme: dark)"

export function normalizeThemeMode(value) {
  return value === "light" || value === "dark" ? value : "system"
}

export function nextThemeMode(mode) {
  const index = THEME_CYCLE.indexOf(normalizeThemeMode(mode))
  return THEME_CYCLE[(index + 1) % THEME_CYCLE.length]
}

export function resolveTheme(mode, systemPrefersDark) {
  if (mode === "system") return systemPrefersDark ? "dark" : "light"
  return mode
}

export function applyTheme(resolved) {
  document.documentElement.classList.toggle("dark", resolved === "dark")
}
