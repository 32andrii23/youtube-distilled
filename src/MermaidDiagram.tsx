// Draws a mermaid diagram from the brief. The analysis writes these as fenced
// mermaid blocks in section 9, and any label carrying a timecode becomes a seek
// control for the floating player.

import { memo, useEffect, useId, useRef, useState } from "react"

import { mermaidCandidates } from "../extension/mermaid-repair.js"
import type { ResolvedTheme } from "./theme"
import { DIAGRAM_CONFIG, DIAGRAM_THEME_VARIABLES } from "./theme"
import { TIMECODE_PATTERN, timecodeToSeconds } from "./timecodes"

// Mermaid puts labels in SVG <text> for some diagram types and in HTML inside a
// <foreignObject> for others, so both have to be swept to find every label.
const LABEL_SELECTOR = "text, foreignObject span, foreignObject p, foreignObject div"

function firstTimecode(text: string) {
  TIMECODE_PATTERN.lastIndex = 0
  return TIMECODE_PATTERN.exec(text)
}

type Mermaid = typeof import("mermaid")["default"]

// Model-written mermaid needs fixing often enough that this is the expected
// path, not the exceptional one. mermaidCandidates hands back the sources worth
// trying, best first; suppressErrors returns false rather than throwing, so each
// can be offered to the parser in turn and only a version mermaid accepts is
// ever drawn.
async function drawable(mermaid: Mermaid, source: string) {
  for (const candidate of mermaidCandidates(source)) {
    if (await mermaid.parse(candidate, { suppressErrors: true })) return candidate
  }
  return null
}

// Memoised because a brief is re-rendered on every keystroke in the follow-up
// box, and redrawing a diagram means losing it and getting it back a frame
// later — the page jumping under the reader as they type.
export default memo(function MermaidDiagram({
  source,
  onTimecode,
  theme,
}: {
  source: string
  onTimecode: (label: string, seconds: number) => void
  theme: ResolvedTheme
}) {
  const [svg, setSvg] = useState("")
  const [failed, setFailed] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  // useId contains colons, which are not valid in the DOM id mermaid assigns.
  const renderId = `diagram-${useId().replace(/[^a-zA-Z0-9]/g, "")}`

  useEffect(() => {
    let cancelled = false

    async function draw() {
      // Dynamic so mermaid's bulk stays out of the startup bundle: most runs
      // never produce a diagram at all.
      const mermaid = (await import("mermaid")).default
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        theme: "base",
        themeVariables: DIAGRAM_THEME_VARIABLES[theme],
        // No sizing here: the app's column is wide enough to let mermaid scale
        // a drawing to fit, which is what the panel cannot do.
        ...DIAGRAM_CONFIG[theme],
      })

      const accepted = await drawable(mermaid, source)
      if (cancelled) return
      if (!accepted) {
        setFailed(true)
        return
      }

      const result = await mermaid.render(renderId, accepted)
      if (!cancelled) setSvg(result.svg)
    }

    setFailed(false)
    setSvg("")
    draw().catch(() => {
      if (!cancelled) setFailed(true)
    })

    return () => {
      cancelled = true
    }
  }, [source, renderId, theme])

  useEffect(() => {
    const container = containerRef.current
    if (!svg || !container) return

    const controller = new AbortController()

    for (const node of container.querySelectorAll(LABEL_SELECTOR)) {
      // Only the innermost label carries the handler, or a click would fire
      // once per wrapper on the way up.
      if (node.querySelector(LABEL_SELECTOR)) continue

      const text = node.textContent ?? ""
      const match = firstTimecode(text)
      if (!match) continue

      const seconds = timecodeToSeconds(match[1])
      node.classList.add("diagram-seek")
      node.addEventListener("click", () => onTimecode(text.trim(), seconds), {
        signal: controller.signal,
      })
    }

    return () => controller.abort()
  }, [svg, onTimecode])

  if (failed) {
    return (
      <div className="diagram-failed">
        <p>This diagram could not be drawn.</p>
        <pre><code>{source}</code></pre>
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className="diagram"
      // Mermaid sanitises its own output under securityLevel "strict".
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
})
