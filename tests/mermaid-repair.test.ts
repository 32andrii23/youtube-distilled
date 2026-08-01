import assert from "node:assert/strict"
import test from "node:test"

import { repairMermaid } from "../extension/mermaid-repair.js"

// Every case here was checked against mermaid's own parser in a browser before
// it became a rule: the "before" fails to parse and the "after" succeeds. The
// repairs only ever run on a diagram mermaid has already rejected, and the
// result is only drawn if it parses, so the rule that matters most is the last
// group — a diagram mermaid was happy with must come back untouched.

test("quotes a flowchart label that carries parentheses", () => {
  assert.equal(
    repairMermaid("flowchart TD\n  A[01:12 Gather sources (three)] --> B[02:30 Verify]"),
    'flowchart TD\n  A["01:12 Gather sources (three)"] --> B[02:30 Verify]',
  )
})

test("quotes every node on a line, not just the first", () => {
  assert.equal(
    repairMermaid("flowchart TD\n  A[one (x)] --> B[two (y)] --> C[three]"),
    'flowchart TD\n  A["one (x)"] --> B["two (y)"] --> C[three]',
  )
})

test("quotes the other node shapes the same way", () => {
  assert.equal(
    repairMermaid("flowchart TD\n  A{Is it true (really)?} --> B(01:12 start (here))"),
    'flowchart TD\n  A{"Is it true (really)?"} --> B("01:12 start (here)")',
  )
  assert.equal(
    repairMermaid("flowchart TD\n  A[[01:12 sub (x)]] --> B([round (y)])"),
    'flowchart TD\n  A[["01:12 sub (x)"]] --> B(["round (y)"])',
  )
})

test("leaves a circle a circle rather than reading it as a rounded box", () => {
  assert.equal(
    repairMermaid("flowchart TD\n  C((circle)) --> D"),
    "flowchart TD\n  C((circle)) --> D",
  )
})

test("escapes a double quote inside a label instead of ending it early", () => {
  assert.equal(
    repairMermaid('flowchart TD\n  A[Use "quotes" inside] --> B[fine]'),
    'flowchart TD\n  A["Use #quot;quotes#quot; inside"] --> B[fine]',
  )
})

test("quotes edge labels and subgraph titles", () => {
  assert.equal(
    repairMermaid('flowchart LR\n  A["x"] -->|yes (mostly)| B["y"]'),
    'flowchart LR\n  A["x"] -->|"yes (mostly)"| B["y"]',
  )
  assert.equal(
    repairMermaid('flowchart TD\n  subgraph First part (early)\n    A["a"] --> B["b"]\n  end'),
    'flowchart TD\n  subgraph "First part (early)"\n    A["a"] --> B["b"]\n  end',
  )
})

test("moves a timeline's timecode to the right of the colon", () => {
  assert.equal(
    repairMermaid("timeline\n  title How it unfolds\n  01:12 : Opening claim\n  05:30 : The turn"),
    "timeline\n  title How it unfolds\n  Opening claim : 01:12\n  The turn : 05:30",
  )
})

test("leaves a timeline that already reads the right way round", () => {
  const source = "timeline\n  title How it unfolds\n  Opening claim : 01:12"
  assert.equal(repairMermaid(source), source)
})

test("turns sankey arrows into the rows a sankey is actually made of", () => {
  assert.equal(
    repairMermaid("sankey-beta\n\nRevenue --> Costs: 50\nRevenue --> Profit: 50"),
    "sankey-beta\n\nRevenue,Costs,50\nRevenue,Profit,50",
  )
})

test("quotes a quadrant point name that carries parentheses", () => {
  assert.equal(
    repairMermaid("quadrantChart\n  x-axis Low --> High\n  Thing (A): [0.3, 0.6]"),
    'quadrantChart\n  x-axis Low --> High\n  "Thing (A)": [0.3, 0.6]',
  )
})

test("drops a caption that was written inside the fence, keeping directives", () => {
  assert.equal(
    repairMermaid('**How the argument unfolds**\nflowchart TD\n  A["one"] --> B["two"]'),
    'flowchart TD\n  A["one"] --> B["two"]',
  )
  assert.equal(
    repairMermaid('%%{init: {}}%%\ncaption\nflowchart TD\n  A["one"]'),
    '%%{init: {}}%%\nflowchart TD\n  A["one"]',
  )
})

test("drops a sentence that wandered in after the diagram", () => {
  assert.equal(
    repairMermaid('flowchart TD\n  A["one"] --> B["two"]\n\nThis diagram shows the flow.'),
    'flowchart TD\n  A["one"] --> B["two"]',
  )
})

test("leaves comments alone", () => {
  const source = 'flowchart TD\n  %% a note (aside)\n  A["one"] --> B["two"]'
  assert.equal(repairMermaid(source), source)
})

// A repair that fires on a diagram mermaid could already draw is worse than no
// repair at all, so the shapes below have to survive the pass untouched.
const ALREADY_VALID = [
  "flowchart TD\n  A[01:12 Gather sources] --> B[02:30 Verify]",
  'flowchart TD\n  A["01:12 Gather (three)"] --> B["02:30 Verify"]',
  "flowchart TD\n  A[one, two, three] --> B[R&D at 50%]",
  "flowchart TD\n  A[**Bold** claim] --> B[cost/benefit]",
  'flowchart TD\n  A["01:12 Start"] --> B["02:00 End"]\n  click A "https://x"',
  'flowchart TD\n  subgraph First part\n    A["a"] --> B["b"]\n  end',
  "flowchart TD\n  A[[01:12 subroutine]] --> B([rounded])",
  "graph TD\n  A[one] --> B[two]",
  "mindmap\n  root((Video))\n    Idea one (important)\n    Idea two",
  "sequenceDiagram\n  participant A as Host (interviewer)\n  A->>A: 01:12 opens",
  "sequenceDiagram\n  A->>B: 01:12 asks about the claim\n  B-->>A: 02:00 answers",
  "sankey-beta\n\nRevenue,Costs,50",
  "quadrantChart\n  x-axis Low --> High\n  Thing A: [0.3, 0.6]",
  "timeline\n  title X\n  section Part one\n    Opening claim : 01:12",
]

for (const source of ALREADY_VALID) {
  test(`leaves valid mermaid alone: ${source.split("\n")[0]} …${source.slice(-18)}`, () => {
    assert.equal(repairMermaid(source), source)
  })
}
