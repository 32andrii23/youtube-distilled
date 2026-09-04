import assert from "node:assert/strict"
import test from "node:test"

import { mermaidCandidates, normalizeMermaid } from "../extension/mermaid-repair.js"

// The repairs in mermaid-repair.test.ts all start from mermaid that fails to
// parse. These start from mermaid that parses perfectly and then draws
// something the video never said, which is the worse failure of the two because
// nothing about it looks wrong. Every case was watched rendering in mermaid 11
// before it became a rule: the "before" drew the wrong picture, the "after"
// drew the intended one.

test("declares a state whose name has spaces instead of losing half of it", () => {
  // `[*] --> Novice investor` draws a state called `Novice`, with `investor`
  // demoted to its description.
  assert.equal(
    normalizeMermaid("stateDiagram-v2\n  [*] --> Novice investor\n  Novice investor --> [*]"),
    'stateDiagram-v2\n  state "Novice investor" as Novice_investor\n  [*] --> Novice_investor\n  Novice_investor --> [*]',
  )
})

test("declares each multi-word state once, however often it is used", () => {
  const normalized = normalizeMermaid(
    "stateDiagram-v2\n  A --> Quiet plateau\n  Quiet plateau --> B\n  B --> Quiet plateau",
  )
  assert.equal(normalized.split('state "Quiet plateau"').length - 1, 1)
  assert.ok(!/--> Quiet plateau/.test(normalized))
})

test("keeps the transition label, timecode and all, when it renames the states", () => {
  assert.equal(
    normalizeMermaid("stateDiagram-v2\n  Cheap money --> Tight money: rates rise 04:12"),
    'stateDiagram-v2\n  state "Cheap money" as Cheap_money\n  state "Tight money" as Tight_money\n  Cheap_money --> Tight_money: rates rise 04:12',
  )
})

test("leaves a state the diagram already declared as the id it declared", () => {
  const source =
    'stateDiagram-v2\n  state "Novice investor" as Novice_investor\n  [*] --> Novice_investor'
  assert.equal(normalizeMermaid(source), source)
})

test("quotes an entity relationship label that runs to more than one word", () => {
  // Unquoted, only `starts` survives as the label.
  assert.equal(
    normalizeMermaid("erDiagram\n  FOUNDER ||--o{ COMPANY : starts and funds"),
    'erDiagram\n  FOUNDER ||--o{ COMPANY : "starts and funds"',
  )
})

test("leaves a one-word relationship label unquoted, because it already draws", () => {
  const source = "erDiagram\n  FOUNDER ||--o{ COMPANY : funds"
  assert.equal(normalizeMermaid(source), source)
})

test("quotes a chart title that would otherwise lose its spaces", () => {
  // `title Users the video cites` draws as `Usersthevideocites`.
  assert.equal(
    normalizeMermaid("xychart-beta\n  title Users the video cites\n  line [10, 90]"),
    'xychart-beta\n  title "Users the video cites"\n  line [10, 90]',
  )
})

test("leaves a title that is already quoted alone", () => {
  const source = 'xychart-beta\n  title "Users the video cites"\n  line [10, 90]'
  assert.equal(normalizeMermaid(source), source)
})

// A normalisation is only ever right about the types it was written for. Every
// other diagram has to come back byte for byte, or the ladder's first rung would
// quietly rewrite drawings that were already correct.
const UNTOUCHED = [
  'flowchart TD\n  A["Fees compound 04:12"] --> B["Returns trail"]',
  "flowchart TD\n  title A --> B",
  "mindmap\n  root((Attention))\n    Capture\n      Novelty",
  "timeline\n  title How the case unfolded\n  1996 : Company founded",
  "sequenceDiagram\n  Alice->>Bob: hands over the draft 04:12",
  "quadrantChart\n  x-axis Low --> High\n  Thing A: [0.3, 0.6]",
  "sankey-beta\n\nRevenue,Costs,50",
  "not a diagram at all",
]

for (const source of UNTOUCHED) {
  test(`normalises nothing in: ${source.split("\n")[0]}`, () => {
    assert.equal(normalizeMermaid(source), source)
  })
}

// The ladder is what makes it safe to normalise before mermaid has said
// anything: the source exactly as written is always still in the running, one
// rung below.
test("offers the normalised source first and the source as written next", () => {
  const written = "stateDiagram-v2\n  [*] --> Novice investor"
  const candidates = mermaidCandidates(written)
  assert.equal(candidates[0], normalizeMermaid(written))
  assert.equal(candidates[1], written)
})

test("keeps the repairs below both, for a source mermaid refuses outright", () => {
  const candidates = mermaidCandidates("flowchart TD\n  A[Gather (three)] --> B[Verify]")
  assert.ok(candidates.includes('flowchart TD\n  A["Gather (three)"] --> B[Verify]'))
  assert.ok(candidates.indexOf('flowchart TD\n  A["Gather (three)"] --> B[Verify]') > 0)
})

test("offers a diagram that needs nothing exactly once", () => {
  assert.deepEqual(mermaidCandidates('flowchart TD\n  A["one"] --> B["two"]'), [
    'flowchart TD\n  A["one"] --> B["two"]',
  ])
})

test("quotes an axis title that would otherwise lose its spaces", () => {
  // `y-axis Percent of the pot lost 0 --> 40` draws as `Percentofthepotlost`.
  assert.equal(
    normalizeMermaid(
      "xychart-beta\n  x-axis Year of the fund [2021, 2022]\n  y-axis Percent of the pot lost 0 --> 40",
    ),
    'xychart-beta\n  x-axis "Year of the fund" [2021, 2022]\n  y-axis "Percent of the pot lost" 0 --> 40',
  )
})

test("leaves an axis that is only a range or a set of categories alone", () => {
  const source = "xychart-beta\n  x-axis [2021, 2022]\n  y-axis 0 --> 100\n  bar [12, 55]"
  assert.equal(normalizeMermaid(source), source)
})
