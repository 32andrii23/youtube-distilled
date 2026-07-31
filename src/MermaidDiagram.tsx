// Draws a mermaid diagram from the brief. The analysis writes these as fenced
// mermaid blocks in section 9; timecoded diagram types carry a real timestamp on
// every node, and those labels become seek controls for the floating player.

import { useEffect, useId, useRef, useState } from "react"

import { TIMECODE_PATTERN, timecodeToSeconds } from "./timecodes"

// Greyscale on white, matching the brief around it. The app has no dark mode,
// so there is nothing to switch between.
const THEME_VARIABLES = {
  background: "#ffffff",
  primaryColor: "#f4f4f4",
  primaryTextColor: "#000000",
  primaryBorderColor: "rgba(0, 0, 0, 0.18)",
  secondaryColor: "#ffffff",
  tertiaryColor: "#fafafa",
  lineColor: "rgba(0, 0, 0, 0.35)",
  textColor: "rgba(0, 0, 0, 0.78)",
  fontSize: "13px",
}

// Mermaid puts labels in SVG <text> for some diagram types and in HTML inside a
// <foreignObject> for others, so both have to be swept to find every label.
const LABEL_SELECTOR = "text, foreignObject span, foreignObject p, foreignObject div"

function firstTimecode(text: string) {
  TIMECODE_PATTERN.lastIndex = 0
  return TIMECODE_PATTERN.exec(text)
}

export default function MermaidDiagram({
  source,
  onTimecode,
}: {
  source: string
  onTimecode: (label: string, seconds: number) => void
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
        themeVariables: THEME_VARIABLES,
      })

      // Model-written mermaid is invalid often enough that this is the expected
      // path, not the exceptional one. suppressErrors returns false, not throws.
      const valid = await mermaid.parse(source, { suppressErrors: true })
      if (cancelled) return
      if (!valid) {
        setFailed(true)
        return
      }

      const result = await mermaid.render(renderId, source)
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
  }, [source, renderId])

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
}
