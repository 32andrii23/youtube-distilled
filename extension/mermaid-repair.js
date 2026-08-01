// Repairs the mermaid a model wrote so it can actually be drawn.
//
// The prompt asks for a narrow, well-formed subset, and the model mostly
// complies — but a brief with five diagrams in it only needs one bad label to
// show a reader "This diagram could not be drawn" instead of the picture. Every
// rule here comes from a syntax the model reaches for often and mermaid rejects,
// checked against mermaid's own parser rather than guessed at:
//
//   flowchart TD                       flowchart TD
//     A[01:12 Gather (three)]     ->     A["01:12 Gather (three)"]
//   timeline                           timeline
//     01:12 : Opening claim       ->     Opening claim : 01:12
//
// Repairs are only ever attempted after the original source has failed to
// parse, and the result is only used if it parses in turn, so a rewrite that
// makes no difference costs nothing and a wrong one cannot replace a good
// drawing. Anything not understood is left exactly as written.
//
// This file is plain ES modules with no dependencies because the panel loads it
// as-is — the panel has no build step — while the web app takes the same file
// through vite. One implementation, so the two surfaces cannot drift apart on
// which diagrams they can draw. mermaid-repair.d.ts is what lets TypeScript see
// it.

// The types the prompt allows, plus the aliases mermaid accepts for them.
const HEADERS = [
  "flowchart",
  "graph",
  "timeline",
  "mindmap",
  "sequenceDiagram",
  "quadrantChart",
  "sankey-beta",
  "sankey",
]
const HEADER_PATTERN = new RegExp(`^\\s*(?:${HEADERS.join("|")})\\b`)

// Mermaid's escape for a double quote inside a quoted label. A raw one ends the
// label early and the rest of the line becomes syntax.
const QUOTE_ENTITY = "#quot;"

// Characters that make mermaid read a label as structure rather than text.
const BREAKS_LABEL = /[(){}"]/

const TIMECODE = "(?:\\d{1,2}:)?\\d{1,2}:\\d{2}"
const TIMELINE_LEADING_TIME = new RegExp(`^(\\s*)(${TIMECODE})\\s*:\\s*(\\S.*)$`)

// `Revenue --> Costs: 50`, which is a flowchart edge rather than the CSV a
// sankey is made of.
const SANKEY_ARROW = /^\s*(.+?)\s*-+>\s*(.+?)\s*[:,]\s*([\d.]+)\s*$/

// A sentence that wandered inside the fence. Kept deliberately narrow: no
// brackets, arrows, or colons, and it has to end like prose.
const TRAILING_PROSE = /^[^[\]{}|<>:]*[.!?]$/

const isComment = (line) => line.trimStart().startsWith("%%")

function quoteLabel(text) {
  return `"${text.replaceAll('"', QUOTE_ENTITY)}"`
}

function isQuoted(text) {
  return text.startsWith('"') && text.endsWith('"') && text.length > 1
}

const count = (text, character) => text.split(character).length - 1

function isBalanced(text) {
  return [["(", ")"], ["[", "]"], ["{", "}"]].every(
    ([open, close]) => count(text, open) === count(text, close),
  )
}

// Node labels, one bracket shape at a time. Each body deliberately cannot hold
// its own closing bracket, so `A[one] --> B[two]` stays two nodes rather than
// one enormous label. The doubled shapes come first, or the single-bracket pass
// would claim half of one and quote the wrong text.
const NODE_SHAPES = [
  { open: "[[", close: "]]", body: "[^\\]]*" },
  { open: "((", close: "))", body: "[^)]*" },
  { open: "([", close: "])", body: "[^\\]]*" },
  { open: "[(", close: ")]", body: "[^\\]]*" },
  { open: "{{", close: "}}", body: "[^}]*" },
  { open: "[", close: "]", body: "[^\\]]*" },
  { open: "{", close: "}", body: "[^}]*" },
  { open: "(", close: ")", body: "[^()]*" },
  // One level of nesting, for `A(01:12 the turn (again))`. The plain round body
  // cannot reach across the inner pair. Text has to precede the inner bracket,
  // or this would read the circle `C((x))` as a rounded box around `(x)`.
  { open: "(", close: ")", body: "[^()]+\\([^()]*\\)[^()]*" },
]

const escapeBracket = (text) => text.replace(/[[\](){}]/g, "\\$&")

// All the shapes in one pass, so each bracket on the line is claimed once. A
// shape per pass would let a later, looser shape read the quotes an earlier one
// had just added as part of the label text.
const NODE_PATTERN = new RegExp(
  `(^|[^\\w\\]})"])(?:${NODE_SHAPES.map(
    (shape) => `([A-Za-z0-9_-]+)${escapeBracket(shape.open)}(${shape.body})${escapeBracket(shape.close)}`,
  ).join("|")})`,
  "g",
)

function quoteNodeLabels(line) {
  return line.replace(NODE_PATTERN, (match, before, ...rest) => {
    // One id/text pair per shape, and exactly one of them took part.
    const captures = rest.slice(0, NODE_SHAPES.length * 2)
    const found = captures.findIndex((value, index) => index % 2 === 0 && value !== undefined)
    if (found < 0) return match

    const shape = NODE_SHAPES[found / 2]
    const [id, text] = captures.slice(found, found + 2)
    // An unbalanced bracket means the shape was read wrong — half of a doubled
    // bracket, most likely. Quoting that text would only make it worse.
    if (isQuoted(text) || !BREAKS_LABEL.test(text) || !isBalanced(text)) return match
    return `${before}${id}${shape.open}${quoteLabel(text)}${shape.close}`
  })
}

// `subgraph First part (early)` — a title mermaid reads as syntax.
function quoteSubgraphTitle(line) {
  return line.replace(/^(\s*subgraph\s+)(\S.*?)\s*$/, (match, keyword, title) => {
    if (isQuoted(title) || title.includes("[") || !BREAKS_LABEL.test(title)) return match
    return `${keyword}${quoteLabel(title)}`
  })
}

// Edge labels: `A -->|yes (mostly)| B`.
function quoteEdgeLabels(line) {
  return line.replace(/\|([^|]*)\|/g, (match, text) => {
    if (isQuoted(text) || !BREAKS_LABEL.test(text)) return match
    return `|${quoteLabel(text)}|`
  })
}

// Point names: `Thing (early): [0.3, 0.6]`.
function quotePointNames(line) {
  return line.replace(/^(\s*)([^:[\]]*[()][^:[\]]*):(\s*\[)/, (match, indent, name, tail) => {
    const text = name.trim()
    if (!text || isQuoted(text)) return match
    return `${indent}${quoteLabel(text)}:${tail}`
  })
}

function toSankeyRow(line) {
  const match = SANKEY_ARROW.exec(line)
  if (!match) return line
  const [, source, target, value] = match
  return `${source.replaceAll(",", " ")},${target.replaceAll(",", " ")},${value}`
}

function swapTimelineTime(line) {
  return line.replace(TIMELINE_LEADING_TIME, (match, indent, time, text) =>
    // `title 01:12 : x` is a title, not an event, and the swap would break it.
    text.trim().startsWith("title") ? match : `${indent}${text.trim()} : ${time}`,
  )
}

// A caption or a stray fence before the header line, which mermaid reads as the
// diagram type and then gives up on. Directives have to survive the trim.
function trimToHeader(lines) {
  const header = lines.findIndex((line) => HEADER_PATTERN.test(line))
  if (header <= 0) return lines
  return [...lines.slice(0, header).filter(isComment), ...lines.slice(header)]
}

function trimTrailingProse(lines) {
  const kept = [...lines]
  while (kept.length > 1) {
    const last = kept[kept.length - 1].trim()
    if (last && !(TRAILING_PROSE.test(last) && last.includes(" "))) break
    kept.pop()
  }
  return kept
}

function diagramType(lines) {
  const header = lines.find((line) => HEADER_PATTERN.test(line))
  return header ? HEADER_PATTERN.exec(header)[0].trim() : ""
}

export function repairMermaid(source) {
  const lines = trimTrailingProse(trimToHeader(String(source).split("\n")))
  const type = diagramType(lines)

  const repaired = lines.map((line, index) => {
    // The header carries the diagram type and, in a flowchart, its direction.
    // Nothing below should touch it, and neither should anything in a comment.
    if (isComment(line) || (index === 0 && HEADER_PATTERN.test(line))) return line

    if (type === "flowchart" || type === "graph") {
      return quoteSubgraphTitle(quoteEdgeLabels(quoteNodeLabels(line)))
    }
    if (type === "timeline") return swapTimelineTime(line)
    if (type === "quadrantChart") return quotePointNames(line)
    if (type === "sankey-beta" || type === "sankey") return toSankeyRow(line)
    return line
  })

  return repaired.join("\n").trim()
}
