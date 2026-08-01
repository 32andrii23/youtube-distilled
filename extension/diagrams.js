// Draws the brief's mermaid diagrams in the panel, mirroring
// src/MermaidDiagram.tsx: the same greyscale theme variables, and timecoded
// labels that seek the video.
//
// The web app imports mermaid through vite. The panel has no build step and MV3
// forbids a CDN, so it loads mermaid's own prebuilt bundle from
// vendor/mermaid.min.js — on demand, since most briefs are read without ever
// scrolling to a diagram, and the bundle is several megabytes.

import { TIMECODE_PATTERN, timecodeToSeconds } from "./markdown.js"
import { repairMermaid } from "./mermaid-repair.js"

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

// Mermaid puts labels in SVG <text> for some diagram types and in HTML inside a
// <foreignObject> for others, so both have to be swept to find every label.
const LABEL_SELECTOR = "text, foreignObject span, foreignObject p, foreignObject div"

// Left to itself, mermaid scales a drawing down to its container. The web app's
// column can take that; a 400px panel cannot — a timeline lands at a third of
// its size, with labels too small to read. Each diagram is drawn at its own size
// instead and the box it sits in scrolls sideways, the way a wide table already
// does here. useMaxWidth is per diagram type, so every type the analysis is
// allowed to use has to say it.
const FIT_TO_CONTENT = { useMaxWidth: false }
const DIAGRAM_SIZING = {
  flowchart: FIT_TO_CONTENT,
  sequence: FIT_TO_CONTENT,
  timeline: FIT_TO_CONTENT,
  mindmap: FIT_TO_CONTENT,
  quadrantChart: FIT_TO_CONTENT,
  sankey: FIT_TO_CONTENT,
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

// Model-written mermaid is invalid often enough that this is an expected path,
// not an exceptional one. suppressErrors returns false rather than throwing, so
// a source that will not parse can be run through the repairs and tried again —
// and only the version that parses is ever drawn.
async function drawable(mermaid, source) {
  if (await mermaid.parse(source, { suppressErrors: true })) return source

  const repaired = repairMermaid(source)
  if (repaired === source) return null
  return (await mermaid.parse(repaired, { suppressErrors: true })) ? repaired : null
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
    ...DIAGRAM_SIZING,
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
