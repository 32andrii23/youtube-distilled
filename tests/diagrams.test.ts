import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import {
  DIAGRAM_CONFIG as panelConfig,
  DIAGRAM_THEME_VARIABLES as panelVariables,
  DIAGRAM_TYPE_KEYS as panelTypeKeys,
  fitToContent,
  firstTimecode,
} from "../extension/diagrams.js"
import { repairMermaid } from "../extension/mermaid-repair.js"
import {
  DIAGRAM_CONFIG as appConfig,
  DIAGRAM_THEME_VARIABLES as appVariables,
  DIAGRAM_TYPE_KEYS as appTypeKeys,
} from "../src/theme.ts"

// Mermaid bakes these into the SVG, so the two surfaces would drift visibly if
// their tables ever diverged. The panel keeps its own copy because it ships as
// plain ES modules with no build step, the same way theme.js does.
test("the panel and the web app draw diagrams with the same theme variables", () => {
  assert.deepEqual(panelVariables, appVariables)
  assert.deepEqual(panelConfig, appConfig)
  assert.deepEqual(panelTypeKeys, appTypeKeys)
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

// The nine types backend/prompt.py lets the analysis draw, against the mermaid
// config key each one is sized under. Mermaid names some of these differently in
// its config than in the header a diagram opens with — `stateDiagram-v2` is
// configured as `state`, `xychart-beta` as `xyChart` — so the mapping has to be
// written down rather than derived. tests/test_prompt.py holds the other half of
// this contract: that the prompt still names exactly these.
const DIAGRAM_TYPES: Record<string, string> = {
  flowchart: "flowchart",
  mindmap: "mindmap",
  "stateDiagram-v2": "state",
  sequenceDiagram: "sequence",
  quadrantChart: "quadrantChart",
  erDiagram: "er",
  timeline: "timeline",
  "sankey-beta": "sankey",
  "xychart-beta": "xyChart",
}

const prompt = readFileSync(new URL("../backend/prompt.py", import.meta.url), "utf8")

const sizing = fitToContent(panelConfig.light)

for (const [type, configKey] of Object.entries(DIAGRAM_TYPES)) {
  // Left to itself mermaid scales a drawing down to the panel's 400px, which
  // costs a diagram its legibility rather than its correctness — so nothing
  // fails loudly when a type is added to the prompt and not to the list here.
  test(`the panel draws a ${type} at its own size`, () => {
    assert.equal(sizing[configKey]?.useMaxWidth, false)
  })

  // trimToHeader drops anything above the header line, and it can only find the
  // header of a type it knows. An unrecognised one keeps the caption a model
  // wandered into the fence, and mermaid reads that as the diagram type.
  test(`the repairs recognise a ${type} header`, () => {
    const diagram = `${type}\n  %% body`
    assert.equal(repairMermaid(`A stray caption\n${diagram}`), diagram)
  })

  test(`the prompt still offers ${type}`, () => {
    assert.ok(prompt.includes(`\`${type}\``))
  })
}

test("the panel sizes nothing the prompt cannot ask for", () => {
  assert.deepEqual([...panelTypeKeys].sort(), Object.values(DIAGRAM_TYPES).sort())
})

// Fitting a diagram to its own size and colouring it are separate settings under
// the same mermaid config key, so the naive spread drops one of the two.
test("sizing a sankey to its content keeps the colour that stops it drawing in gradients", () => {
  assert.deepEqual(sizing.sankey, { linkColor: panelConfig.light.sankey.linkColor, useMaxWidth: false })
})

// Mermaid draws an xychart from its own pastel palette rather than from
// lineColor, which lands a near-invisible yellow line on white.
test("both themes give an xychart a plot colour of their own", () => {
  for (const theme of ["light", "dark"] as const) {
    const palette = (panelVariables[theme].xyChart as { plotColorPalette: string }).plotColorPalette
    assert.ok(palette.split(",").length >= 2)
  }
  assert.notEqual(
    (panelVariables.light.xyChart as { plotColorPalette: string }).plotColorPalette,
    (panelVariables.dark.xyChart as { plotColorPalette: string }).plotColorPalette,
  )
})
