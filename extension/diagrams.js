// Draws the brief's mermaid diagrams in the panel, mirroring
// src/MermaidDiagram.tsx: the same greyscale theme variables, and timecoded
// labels that seek the video.
//
// The web app imports mermaid through vite. The panel has no build step and MV3
// forbids a CDN, so it loads mermaid's own prebuilt bundle from
// vendor/mermaid.min.js — on demand, since most briefs are read without ever
// scrolling to a diagram, and the bundle is several megabytes.

import { TIMECODE_PATTERN, timecodeToSeconds } from "./markdown.js"
import { mermaidCandidates } from "./mermaid-repair.js"

const MERMAID_URL = "vendor/mermaid.min.js"

// Kept in step with DIAGRAM_THEME_VARIABLES in src/theme.ts; tests/diagrams.test.ts
// asserts the two against each other.
export const DIAGRAM_THEME_VARIABLES = {
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

// Mermaid puts labels in SVG <text> for some diagram types and in HTML inside a
// <foreignObject> for others, so both have to be swept to find every label.
const LABEL_SELECTOR = "text, foreignObject span, foreignObject p, foreignObject div"

// Left to itself, mermaid scales a drawing down to its container. The web app's
// column can take that; a 400px panel cannot — a timeline lands at a third of
// its size, with labels too small to read. Each diagram is drawn at its own size
// instead and the box it sits in scrolls sideways, the way a wide table already
// does here. useMaxWidth is per diagram type, so every type the analysis is
// allowed to use has to say it — and has to say it on top of whatever config
// that type already carries, rather than in place of it.
export function fitToContent(config) {
  return Object.fromEntries(
    DIAGRAM_TYPE_KEYS.map((key) => [key, { ...config[key], useMaxWidth: false }]),
  )
}

// The bundle is a classic script that hangs mermaid off globalThis. One load per
// panel, shared by every diagram and every redraw.
let loadingMermaid = null

// Mermaid derives DOM ids from this, so it has to be unique per render.
let renderCount = 0

// A theme flip redraws every diagram. Only the newest pass may write, or a slow
// render from the previous theme could land last.
let generation = 0

export function firstTimecode(text) {
  TIMECODE_PATTERN.lastIndex = 0
  return TIMECODE_PATTERN.exec(text)
}

function loadMermaid() {
  if (globalThis.mermaid) return Promise.resolve(globalThis.mermaid)

  loadingMermaid ??= new Promise((resolve, reject) => {
    const script = document.createElement("script")
    script.src = MERMAID_URL
    script.addEventListener("load", () => resolve(globalThis.mermaid))
    script.addEventListener("error", () => {
      // Cleared so a later brief can try again rather than inheriting this failure.
      loadingMermaid = null
      reject(new Error("The mermaid bundle could not be loaded."))
    })
    document.head.append(script)
  })

  return loadingMermaid
}

// Every label carrying a timecode becomes a seek control. data-seconds is what
// the panel's own click delegation looks for, so the SVG needs no listeners of
// its own.
function markSeekLabels(figure) {
  for (const node of figure.querySelectorAll(LABEL_SELECTOR)) {
    // Only the innermost label is marked, so one click cannot resolve to two
    // different timecodes on the way up.
    if (node.querySelector(LABEL_SELECTOR)) continue

    const match = firstTimecode(node.textContent ?? "")
    if (!match) continue

    node.classList.add("diagram-seek")
    node.dataset.seconds = String(timecodeToSeconds(match[1]))
  }
}

function markFailed(container) {
  container.classList.add("diagram-failed")

  const note = document.createElement("p")
  note.className = "diagram-note"
  note.textContent = "This diagram could not be drawn."
  container.prepend(note)
}

// Model-written mermaid needs fixing often enough that this is an expected path,
// not an exceptional one. mermaidCandidates hands back the sources worth trying,
// best first; suppressErrors returns false rather than throwing, so each can be
// offered to the parser in turn and only a version mermaid accepts is ever
// drawn.
async function drawable(mermaid, source) {
  for (const candidate of mermaidCandidates(source)) {
    if (await mermaid.parse(candidate, { suppressErrors: true })) return candidate
  }
  return null
}

async function draw(mermaid, container) {
  const written = container.querySelector(".diagram-source")?.textContent ?? ""

  container.classList.remove("diagram-drawn", "diagram-failed")
  container.querySelector(".diagram-note")?.remove()
  container.querySelector(".diagram-figure")?.remove()

  const source = await drawable(mermaid, written)
  if (!source) {
    markFailed(container)
    return
  }

  renderCount += 1
  const { svg } = await mermaid.render(`panel-diagram-${renderCount}`, source)

  const figure = document.createElement("div")
  figure.className = "diagram-figure"
  // Mermaid sanitises its own output under securityLevel "strict".
  figure.innerHTML = svg
  markSeekLabels(figure)

  container.append(figure)
  // Hides the source, which was standing in until the drawing arrived.
  container.classList.add("diagram-drawn")
}

export async function drawDiagrams(root, theme) {
  const containers = [...root.querySelectorAll(".diagram")]
  if (!containers.length) return

  const pass = ++generation

  let mermaid
  try {
    mermaid = await loadMermaid()
  } catch {
    // Every diagram keeps showing its source, which is all the panel could do
    // before it drew them at all.
    return
  }

  if (pass !== generation) return

  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: "base",
    themeVariables: DIAGRAM_THEME_VARIABLES[theme] ?? DIAGRAM_THEME_VARIABLES.light,
    ...fitToContent(DIAGRAM_CONFIG[theme] ?? DIAGRAM_CONFIG.light),
  })

  // One at a time: mermaid is a singleton that renders through shared state, and
  // a brief has a handful of diagrams at most.
  for (const container of containers) {
    if (pass !== generation) return
    try {
      await draw(mermaid, container)
    } catch {
      markFailed(container)
    }
  }
}
