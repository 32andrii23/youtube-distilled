import assert from "node:assert/strict"
import test from "node:test"

import * as extensionTheme from "../extension/theme.js"
import * as appTheme from "../src/theme.ts"

// The web app and the side panel carry separate copies of these rules, because
// the panel ships as plain ES modules with no build step. Every case runs against
// both so the two cannot drift apart.
const implementations = [
  { name: "src/theme.ts", theme: appTheme },
  { name: "extension/theme.js", theme: extensionTheme },
]

for (const { name, theme } of implementations) {
  test(`${name}: falls back to system for anything unrecognised`, () => {
    assert.equal(theme.normalizeThemeMode("light"), "light")
    assert.equal(theme.normalizeThemeMode("dark"), "dark")
    assert.equal(theme.normalizeThemeMode("system"), "system")

    assert.equal(theme.normalizeThemeMode(null), "system")
    assert.equal(theme.normalizeThemeMode(undefined), "system")
    assert.equal(theme.normalizeThemeMode(""), "system")
    assert.equal(theme.normalizeThemeMode("Dark"), "system")
    assert.equal(theme.normalizeThemeMode("midnight"), "system")
    assert.equal(theme.normalizeThemeMode(0), "system")
    assert.equal(theme.normalizeThemeMode({}), "system")
  })

  test(`${name}: cycles system to light to dark and wraps`, () => {
    assert.equal(theme.nextThemeMode("system"), "light")
    assert.equal(theme.nextThemeMode("light"), "dark")
    assert.equal(theme.nextThemeMode("dark"), "system")
  })

  test(`${name}: cycling three times returns to the starting mode`, () => {
    for (const start of ["system", "light", "dark"] as const) {
      const after = theme.nextThemeMode(theme.nextThemeMode(theme.nextThemeMode(start)))
      assert.equal(after, start)
    }
  })

  test(`${name}: a corrupt stored mode still cycles into a valid one`, () => {
    assert.equal(theme.nextThemeMode("midnight" as never), "light")
  })

  test(`${name}: only system defers to the OS preference`, () => {
    assert.equal(theme.resolveTheme("system", true), "dark")
    assert.equal(theme.resolveTheme("system", false), "light")
    assert.equal(theme.resolveTheme("light", true), "light")
    assert.equal(theme.resolveTheme("light", false), "light")
    assert.equal(theme.resolveTheme("dark", true), "dark")
    assert.equal(theme.resolveTheme("dark", false), "dark")
  })
}

test("both implementations agree on the storage key", () => {
  assert.equal(appTheme.THEME_KEY, extensionTheme.THEME_KEY)
  assert.equal(appTheme.DARK_MEDIA_QUERY, extensionTheme.DARK_MEDIA_QUERY)
})
