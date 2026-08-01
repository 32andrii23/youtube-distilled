// Draws a mermaid diagram from the brief. The analysis writes these as fenced
// mermaid blocks in section 9; timecoded diagram types carry a real timestamp on
// every node, and those labels become seek controls for the floating player.

import { memo, useEffect, useId, useRef, useState } from "react"

import { repairMermaid } from "../extension/mermaid-repair.js"
import type { ResolvedTheme } from "./theme"
import { DIAGRAM_THEME_VARIABLES } from "./theme"
import { TIMECODE_PATTERN, timecodeToSeconds } from "./timecodes"

// Mermaid puts labels in SVG <text> for some diagram types and in HTML inside a
// <foreignObject> for others, so both have to be swept to find every label.
const LABEL_SELECTOR = "text, foreignObject span, foreignObject p, foreignObject div"

function firstTimecode(text: string) {
  TIMECODE_PATTERN.lastIndex = 0
  return TIMECODE_PATTERN.exec(text)
}

type Mermaid = typeof import("mermaid")["default"]

async function repaired(mermaid: Mermaid, source: string) {
  const candidate = repairMermaid(source)
  if (candidate === source) return null
  return (await mermaid.parse(candidate, { suppressErrors: true })) ? candidate : null
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
      })

      // Model-written mermaid is invalid often enough that this is the expected
      // path, not the exceptional one. suppressErrors returns false, not throws,
      // so a source that will not parse gets the repairs applied and one more
      // try. Only the version that parses is ever drawn.
      const drawable = (await mermaid.parse(source, { suppressErrors: true }))
        ? source
        : await repaired(mermaid, source)
      if (cancelled) return
      if (!drawable) {
        setFailed(true)
        return
      }

      const result = await mermaid.render(renderId, drawable)
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
