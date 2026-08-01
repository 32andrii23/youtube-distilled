import assert from "node:assert/strict"
import test from "node:test"

import { DIAGRAM_THEME_VARIABLES as panelVariables, firstTimecode } from "../extension/diagrams.js"
import { DIAGRAM_THEME_VARIABLES as appVariables } from "../src/theme.ts"

// Mermaid bakes these into the SVG, so the two surfaces would drift visibly if
// their tables ever diverged. The panel keeps its own copy because it ships as
// plain ES modules with no build step, the same way theme.js does.
test("the panel and the web app draw diagrams with the same theme variables", () => {
  assert.deepEqual(panelVariables, appVariables)
})

test("both themes are defined, and neither is empty", () => {
  for (const theme of ["light", "dark"] as const) {
    assert.ok(Object.keys(panelVariables[theme]).length > 0)
  }
  assert.notDeepEqual(panelVariables.light, panelVariables.dark)
})

test("finds the timecode that a diagram label starts with", () => {
  assert.equal(firstTimecode("01:30 Opening claim")?.[1], "01:30")
  assert.equal(firstTimecode("Opening claim : 01:30")?.[1], "01:30")
  assert.equal(firstTimecode("1:02:03 — the turn")?.[1], "1:02:03")
})

test("finds the first timecode of a range, not the end of it", () => {
  assert.equal(firstTimecode("04:10–05:20 the rebuttal")?.[1], "04:10")
})

test("reports no timecode for a label without one", () => {
  assert.equal(firstTimecode("Opening claim"), null)
  assert.equal(firstTimecode(""), null)
})

// The pattern is a global regex shared with markdown.js, so a stale lastIndex
// would make every other label unseekable.
test("does not carry a match position between labels", () => {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    assert.equal(firstTimecode("01:30 Opening claim")?.[1], "01:30")
  }
})
