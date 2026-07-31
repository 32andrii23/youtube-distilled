# Brief Diagrams Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the analysis draw up to five Mermaid diagrams in a new section 9 of the brief, with timecoded diagram types rendering as clickable seek controls.

**Architecture:** Diagrams ride inside the existing brief Markdown as fenced ` ```mermaid ` blocks, so the backend change is one prompt section and `backend/main.py` is untouched. The web app renders them through a new `MermaidDiagram` component reached from react-markdown's `code` override, which dynamically imports Mermaid, validates with `mermaid.parse`, renders to SVG, and then walks the SVG's label nodes to attach seek handlers. The extension panel does not draw diagrams but must stop them from corrupting its renderer and its seek-bar markers.

**Tech Stack:** React 19, react-markdown 10 + remark-gfm, Mermaid 11, Vite 8, TypeScript, Tailwind 4, FastAPI, Python 3, `node --test` and `unittest`.

## Global Constraints

- Mermaid `securityLevel` is `strict` and is never loosened. Mermaid's `click` directive is never used.
- Mermaid is loaded by dynamic `import("mermaid")` only, never a static top-level import — it must stay out of the startup bundle.
- The six permitted diagram types are exactly: `timeline`, `flowchart`, `sequenceDiagram`, `mindmap`, `quadrantChart`, `sankey-beta`.
- Timecoded types (`timeline`, `flowchart`, `sequenceDiagram`) require a timecode on every node. Explanatory types (`mindmap`, `quadrantChart`, `sankey-beta`) forbid timecodes in labels.
- The diagram cap is five. Zero is explicitly a correct answer.
- The app is light-mode monochrome — there is no dark mode in `src/index.css`. Diagram theming is greyscale on white.
- The full check is `npm test`, which runs `tsc --noEmit`, `vite build`, `node --test tests/*.test.ts`, and `.venv/bin/python -m unittest discover -s tests`.
- Do not commit the unrelated in-flight changes to `backend/main.py`, `backend/prompt.py`, and `src/App.tsx` (a follow-up-questions feature) beyond the specific edits each task names. Stage files explicitly, never `git add -A`.

---

### Task 1: Make `linkifyTimecodes` code-aware

`linkifyTimecodes` regex-rewrites the entire raw Markdown string before react-markdown parses it. A `timeline` diagram is full of timecodes, and each one would become `[00:15](#t=15)` inside the fence, breaking the Mermaid parse. Nothing else in the codebase would catch this regression, which is why it is tested first and separately.

**Files:**
- Modify: `src/timecodes.ts`
- Test: `tests/timecodes.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `linkifyTimecodes(markdown: string): string` — unchanged signature, now skipping fenced code blocks and inline code spans. `timecodeToSeconds(timecode: string): number` and `TIMECODE_PATTERN` keep their current behaviour; `TIMECODE_PATTERN` becomes an exported const so Task 3 can reuse it.

- [ ] **Step 1: Write the failing tests**

Append to `tests/timecodes.test.ts`:

```ts
test("leaves timecodes inside a fenced block alone", () => {
  const markdown = ["Watch 01:00 first.", "", "```mermaid", "timeline", "  01:00 : Intro", "```", "", "Then 02:00."].join("\n")

  assert.equal(
    linkifyTimecodes(markdown),
    ["Watch [01:00](#t=60) first.", "", "```mermaid", "timeline", "  01:00 : Intro", "```", "", "Then [02:00](#t=120)."].join("\n"),
  )
})

test("leaves an unterminated fence alone to the end of the document", () => {
  const markdown = ["```mermaid", "timeline", "  03:00 : Cut off"].join("\n")

  assert.equal(linkifyTimecodes(markdown), markdown)
})

test("leaves timecodes inside an inline code span alone", () => {
  assert.equal(linkifyTimecodes("Use `01:00` literally, seek 02:00."), "Use `01:00` literally, seek [02:00](#t=120).")
})

test("closes a fence only on a matching marker", () => {
  const markdown = ["~~~mermaid", "timeline", "  04:00 : Still fenced", "```", "  05:00 : Also fenced", "~~~", "", "Free 06:00."].join("\n")

  assert.equal(
    linkifyTimecodes(markdown),
    ["~~~mermaid", "timeline", "  04:00 : Still fenced", "```", "  05:00 : Also fenced", "~~~", "", "Free [06:00](#t=360)."].join("\n"),
  )
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/timecodes.test.ts`
Expected: FAIL — the first test reports the fenced `01:00` was rewritten to `[01:00](#t=60)`.

- [ ] **Step 3: Rewrite `src/timecodes.ts`**

Replace the whole file with:

```ts
export const TIMECODE_PATTERN = /(?<![\w:/])((?:\d{1,2}:)?\d{1,2}:\d{2})(?:\s*[–—-]\s*((?:\d{1,2}:)?\d{1,2}:\d{2}))?/g

// A fence opens on three or more backticks or tildes, indented no more than
// three spaces, and closes only on the same character repeated at least as
// many times. Diagrams live inside these, so nothing in here may be rewritten.
const FENCE_PATTERN = /^ {0,3}(`{3,}|~{3,})/
const INLINE_CODE_PATTERN = /(`+[^`]*`+)/

export function timecodeToSeconds(timecode: string) {
  return timecode.split(":").reduce((total, part) => total * 60 + Number(part), 0)
}

function linkifyText(text: string) {
  return text.replace(
    TIMECODE_PATTERN,
    (match, start) => `[${match}](#t=${timecodeToSeconds(start)})`,
  )
}

// Splitting on the capture group leaves code spans at the odd indices, which
// keeps a literal `01:00` in prose from turning into a seek link.
function linkifyLine(line: string) {
  return line
    .split(INLINE_CODE_PATTERN)
    .map((part, index) => (index % 2 ? part : linkifyText(part)))
    .join("")
}

export function linkifyTimecodes(markdown: string) {
  let fence: string | null = null

  return markdown
    .split("\n")
    .map((line) => {
      const marker = FENCE_PATTERN.exec(line)?.[1]

      if (fence) {
        if (marker && marker[0] === fence[0] && marker.length >= fence.length) fence = null
        return line
      }

      if (marker) {
        fence = marker
        return line
      }

      return linkifyLine(line)
    })
    .join("\n")
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/timecodes.test.ts`
Expected: PASS, all seven tests (three existing, four new).

- [ ] **Step 5: Commit**

```bash
git add src/timecodes.ts tests/timecodes.test.ts
git commit -m "Keep timecode linkifying out of code blocks"
```

---

### Task 2: Collapse the duplicated brief renderer

The `a` component override that turns `#t=` links into seek buttons appears verbatim twice in `src/App.tsx` — once inside `AnswerMarkdown` (around line 228) and once inline in the section loop (around line 820). Task 3 adds a `code` override that both need, so unify first rather than duplicating a third time. This task is a pure refactor: no behaviour changes.

**Files:**
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `linkifyTimecodes` from `src/timecodes.ts` (Task 1).
- Produces: `BriefMarkdown({ content, onTimecode }: { content: string; onTimecode: (label: string, seconds: number) => void })` — a single React component rendering brief Markdown with seek-aware links. Task 3 adds the `code` override to this one component.

- [ ] **Step 1: Add the unified component**

In `src/App.tsx`, replace the entire `AnswerMarkdown` function with:

```tsx
function BriefMarkdown({
  content,
  onTimecode,
}: {
  content: string
  onTimecode: (label: string, seconds: number) => void
}) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ children, href }) => {
          if (href?.startsWith("#t=")) {
            const seconds = Number(href.slice(3))
            const label = String(children)
            return (
              <Button
                variant="link"
                size="xs"
                className="timecode-link h-auto min-w-0 rounded-none p-0 font-normal"
                onClick={() => onTimecode(label, seconds)}
              >
                {children}
              </Button>
            )
          }

          return <a href={href} target="_blank" rel="noreferrer">{children}</a>
        },
      }}
    >
      {linkifyTimecodes(content)}
    </ReactMarkdown>
  )
}
```

- [ ] **Step 2: Point the follow-up answer at it**

Find the follow-up answer render (around line 888):

```tsx
<AnswerMarkdown content={item.answer} onTimecode={playTimecode} />
```

Replace with:

```tsx
<BriefMarkdown content={item.answer} onTimecode={playTimecode} />
```

- [ ] **Step 3: Point the section loop at it**

In the section loop (around line 819), replace the whole `<ReactMarkdown ...>...</ReactMarkdown>` element — the one wrapped in `<div className="summary-markdown min-w-0 overflow-x-auto">` — so the div's contents become exactly:

```tsx
<BriefMarkdown content={section.content} onTimecode={playTimecode} />
```

- [ ] **Step 4: Verify no stale references remain**

Run: `grep -n "AnswerMarkdown\|ReactMarkdown" src/App.tsx`
Expected: the `import ReactMarkdown` line and exactly one `<ReactMarkdown` usage, both inside `BriefMarkdown`. No `AnswerMarkdown` anywhere.

- [ ] **Step 5: Typecheck and build**

Run: `npm run build`
Expected: PASS with no TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx
git commit -m "Render every brief surface through one markdown component"
```

---

### Task 3: Render Mermaid diagrams with seekable nodes

**Files:**
- Create: `src/MermaidDiagram.tsx`
- Modify: `src/App.tsx`, `src/index.css`, `package.json`

**Interfaces:**
- Consumes: `TIMECODE_PATTERN` and `timecodeToSeconds` from `src/timecodes.ts` (Task 1); `BriefMarkdown` from `src/App.tsx` (Task 2).
- Produces: `MermaidDiagram({ source, onTimecode }: { source: string; onTimecode: (label: string, seconds: number) => void })`, default export of `src/MermaidDiagram.tsx`.

- [ ] **Step 1: Install Mermaid**

Run: `npm install mermaid@^11`
Expected: `mermaid` appears under `dependencies` in `package.json`.

- [ ] **Step 2: Create the component**

Create `src/MermaidDiagram.tsx`:

```tsx
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
  // useId contains colons, which are not valid in the DOM id Mermaid assigns.
  const renderId = `diagram-${useId().replace(/[^a-zA-Z0-9]/g, "")}`

  useEffect(() => {
    let cancelled = false

    async function draw() {
      // Dynamic so Mermaid's ~480KB stays out of the startup bundle: most runs
      // never produce a diagram at all.
      const mermaid = (await import("mermaid")).default
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        theme: "base",
        themeVariables: THEME_VARIABLES,
      })

      // LLM-written Mermaid is invalid often enough that this is the expected
      // path, not the exceptional one. suppressErrors returns false, not throw.
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
```

- [ ] **Step 3: Wire it into `BriefMarkdown`**

In `src/App.tsx`, add the import next to the other local imports:

```tsx
import MermaidDiagram from "./MermaidDiagram"
```

Then in `BriefMarkdown`, add a `code` entry to the `components` object, directly after the `a` entry:

```tsx
        code: ({ className, children, ...props }) => {
          if (className === "language-mermaid") {
            return <MermaidDiagram source={String(children).trimEnd()} onTimecode={onTimecode} />
          }

          return <code className={className} {...props}>{children}</code>
        },
```

- [ ] **Step 4: Style the diagram**

Append to `src/index.css`:

```css
.summary-markdown .diagram {
  margin: 1.25rem 0;
  overflow-x: auto;
  border: 1px solid rgb(0 0 0 / 0.1);
  border-radius: 0.6rem;
  background: #fff;
  padding: 1rem;
  text-align: center;
}

.summary-markdown .diagram svg {
  max-width: 100%;
  height: auto;
}

.summary-markdown .diagram-seek {
  cursor: pointer;
  text-decoration: underline;
  text-decoration-color: rgb(0 0 0 / 0.3);
  text-underline-offset: 3px;
}

.summary-markdown .diagram-failed {
  margin: 1.25rem 0;
  border: 1px solid rgb(0 0 0 / 0.1);
  border-radius: 0.6rem;
  padding: 1rem;
}

.summary-markdown .diagram-failed p {
  margin: 0 0 0.6rem;
  color: rgb(0 0 0 / 0.45);
  font-size: 0.82rem;
}

.summary-markdown .diagram-failed pre {
  overflow-x: auto;
  margin: 0;
}

.summary-markdown .diagram-failed code {
  display: block;
  border: 0;
  background: none;
  padding: 0;
  white-space: pre;
}
```

- [ ] **Step 5: Typecheck and build**

Run: `npm run build`
Expected: PASS. In the build output, `mermaid` appears as its own chunk rather than inside the main entry chunk — this confirms the dynamic import worked.

- [ ] **Step 6: Verify in the running app**

Run: `./scripts/start.sh`

In the browser at `localhost:4321`, use the browser devtools console to confirm the render path without spending a CLI run. Then analyze any video whose brief you can hand-edit, or temporarily paste this into a brief section to confirm rendering:

````
```mermaid
timeline
  title How the argument unfolds
  01:12 : Opening claim
  04:30 : Counterexample
  09:05 : Resolution
```
````

Expected: a rendered timeline; the three timecoded labels are underlined and show a pointer cursor; clicking one opens the floating player at that second. Then confirm the failure path by breaking the syntax (change `timeline` to `timelineX`): the source appears in a bordered code block under "This diagram could not be drawn." and the rest of the brief still renders.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/MermaidDiagram.tsx src/App.tsx src/index.css
git commit -m "Draw mermaid diagrams in the brief with seekable nodes"
```

---

### Task 4: Ask for the diagrams

**Files:**
- Modify: `backend/prompt.py`
- Test: `tests/test_prompt.py` (create)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `SUMMARY_PROMPT` in `backend/prompt.py` gains a section 9. No signature changes; `build_prompt(video_url, context)` is untouched.

- [ ] **Step 1: Write the failing test**

Create `tests/test_prompt.py`:

```python
import unittest

from backend.prompt import SUMMARY_PROMPT

TIMECODED_TYPES = ("timeline", "flowchart", "sequenceDiagram")
EXPLANATORY_TYPES = ("mindmap", "quadrantChart", "sankey-beta")


class SummaryPromptDiagramTests(unittest.TestCase):
    def test_asks_for_a_diagrams_section(self) -> None:
        self.assertIn("## 9. Diagrams", SUMMARY_PROMPT)

    def test_names_every_permitted_diagram_type(self) -> None:
        for diagram_type in TIMECODED_TYPES + EXPLANATORY_TYPES:
            with self.subTest(diagram_type=diagram_type):
                self.assertIn(diagram_type, SUMMARY_PROMPT)

    def test_caps_the_diagram_count_and_allows_none(self) -> None:
        self.assertIn("up to five", SUMMARY_PROMPT)
        self.assertIn("Zero diagrams is a correct", SUMMARY_PROMPT)

    def test_forbids_the_click_directive(self) -> None:
        self.assertIn("click", SUMMARY_PROMPT)
        self.assertIn("Never use Mermaid's `click` directive", SUMMARY_PROMPT)

    def test_lists_the_new_section_in_the_structure(self) -> None:
        self.assertLess(SUMMARY_PROMPT.index("## 8. Final Compression"), SUMMARY_PROMPT.index("## 9. Diagrams"))


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `.venv/bin/python -m unittest tests.test_prompt -v`
Expected: FAIL — `test_asks_for_a_diagrams_section` reports `'## 9. Diagrams' not found`.

- [ ] **Step 3: Add section 9 to the prompt**

In `backend/prompt.py`, inside the `SUMMARY_PROMPT` string, insert this between the `## 8. Final Compression` block and the closing `Important:` block:

```
## 9. Diagrams
Draw up to five Mermaid diagrams, but only where a picture carries something the prose cannot say as compactly. Zero diagrams is a correct and common answer: narrative, interview, and commentary videos usually have no structure worth drawing. Do not fill this section. If nothing qualifies, say in one line that the video had no structure worth drawing and stop.

Use only these six diagram types.

Timecoded — every event, node, or message must carry a timecode:
- `timeline` — how the video's argument unfolds
- `flowchart` — a process or decision path the video teaches
- `sequenceDiagram` — an exchange or interaction the video walks through

Explanatory — never put a timecode in these labels:
- `mindmap` — how the video's concepts relate
- `quadrantChart` — a two-axis comparison the video makes
- `sankey-beta` — flows or proportions, and only when the video states real numbers

Rules for this section:
- Put each diagram in its own ```mermaid fenced code block, with a short bold caption line above it.
- Timecodes in a timecoded diagram follow the same rule as the rest of this brief: only times supported by the supplied material, never invented. If you cannot source a real time for every node, use an explanatory type instead, or draw nothing.
- Never use Mermaid's `click` directive. The app wires up seeking itself.
- Keep each diagram under about twelve nodes. Anything larger belongs in prose.
- Write plain label text. Parentheses, quotes, and semicolons inside labels break Mermaid parsing.
```

Also update the section list near the top of `SUMMARY_PROMPT` if it enumerates sections, so section 9 is not a surprise.

- [ ] **Step 4: Run the test to verify it passes**

Run: `.venv/bin/python -m unittest tests.test_prompt -v`
Expected: PASS, all five tests.

- [ ] **Step 5: Commit**

```bash
git add backend/prompt.py tests/test_prompt.py
git commit -m "Ask the analysis for diagrams"
```

Note: `backend/prompt.py` also carries unrelated in-flight follow-up-prompt work. Staging the whole file is unavoidable here since both changes live in it — mention this in the commit review rather than trying to split the file.

---

### Task 5: Stop diagrams from corrupting the extension panel

The panel does not draw diagrams, but it currently mishandles them twice. `renderMarkdown` has no fence branch, so a ` ```mermaid ` block becomes broken paragraph text with its timecodes linkified into seek buttons. And `extractMoments` falls back to scanning every line of the brief when the watch guide yields nothing, so a `timeline` diagram would flood the YouTube seek bar with bogus markers.

**Files:**
- Modify: `extension/markdown.js`, `extension/moments.js`
- Test: `tests/extension-markdown.test.ts`, `tests/extension-moments.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `renderMarkdown(markdown)` now emits `<pre><code>…</code></pre>` for fenced blocks. `extractMoments(markdown)` now ignores fenced blocks entirely. Both keep their signatures.

- [ ] **Step 1: Write the failing tests**

Append to `tests/extension-markdown.test.ts`:

```ts
test("renders a fenced block as code without linkifying its timecodes", () => {
  const markdown = ["```mermaid", "timeline", "  01:00 : Intro", "```"].join("\n")

  assert.equal(
    renderMarkdown(markdown),
    "<pre><code>timeline\n  01:00 : Intro</code></pre>",
  )
})

test("escapes html inside a fenced block", () => {
  const markdown = ["```", "<script>alert(1)</script>", "```"].join("\n")

  assert.equal(
    renderMarkdown(markdown),
    "<pre><code>&lt;script&gt;alert(1)&lt;/script&gt;</code></pre>",
  )
})

test("keeps rendering normally after a fence closes", () => {
  const markdown = ["```", "code 01:00", "```", "", "Then 02:00."].join("\n")

  assert.match(renderMarkdown(markdown), /<pre><code>code 01:00<\/code><\/pre><p>Then <button[^>]*data-seconds="120"/)
})
```

Append to `tests/extension-moments.test.ts`:

```ts
test("ignores timecodes inside a diagram when falling back to the whole brief", () => {
  const markdown = [
    "## 9. Diagrams",
    "",
    "```mermaid",
    "timeline",
    "  01:00 : Opening claim",
    "  02:00 : Counterexample",
    "```",
  ].join("\n")

  assert.deepEqual(extractMoments(markdown), [])
})

test("still finds prose moments alongside a diagram", () => {
  const markdown = [
    "## 3. Watch Guide",
    "",
    "- 05:00 The part that matters",
    "",
    "## 9. Diagrams",
    "",
    "```mermaid",
    "timeline",
    "  01:00 : Opening claim",
    "```",
  ].join("\n")

  const moments = extractMoments(markdown)
  assert.equal(moments.length, 1)
  assert.equal(moments[0].startSeconds, 300)
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/extension-markdown.test.ts tests/extension-moments.test.ts`
Expected: FAIL — the markdown test reports a `<p>` of broken text instead of `<pre><code>`, and the moments test reports two moments at 60 and 120 instead of none.

- [ ] **Step 3: Add fence handling to `extension/markdown.js`**

Add the pattern next to the other block patterns (after `CODE_SPAN_PATTERN`, around line 27):

```js
const FENCE_PATTERN = /^ {0,3}(`{3,}|~{3,})/
```

Add this function directly above `renderParagraph`:

```js
// Diagrams arrive as fenced mermaid blocks. The panel does not draw them, so it
// shows the source instead — escaped, and with no inline pass, which is what
// keeps a timeline's timecodes from becoming seek buttons.
function renderFence(lines, start) {
  const marker = FENCE_PATTERN.exec(lines[start])[1]
  const body = []
  let index = start + 1

  while (index < lines.length) {
    const closing = FENCE_PATTERN.exec(lines[index])?.[1]
    if (closing && closing[0] === marker[0] && closing.length >= marker.length) {
      index += 1
      break
    }
    body.push(lines[index])
    index += 1
  }

  return { html: `<pre><code>${escapeHtml(body.join("\n"))}</code></pre>`, next: index }
}
```

In `isBlockStart`, add the fence test as the first condition in the returned expression:

```js
    FENCE_PATTERN.test(line)
    || HEADING_PATTERN.test(line)
```

In `renderMarkdown`, add the fence branch as the first of the `block` assignments, before `isTableStart`:

```js
    let block
    if (FENCE_PATTERN.test(line)) block = renderFence(lines, index)
    else if (isTableStart(lines, index)) block = renderTable(lines, index)
```

- [ ] **Step 4: Strip fences in `extension/moments.js`**

Add this function above `watchGuideLines`:

```js
// The whole-brief fallback below would otherwise read a timeline diagram's
// labels as watch moments and mark the seek bar with times nobody chose.
function withoutFences(lines) {
  const kept = []
  let fence = null

  for (const line of lines) {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1]

    if (fence) {
      if (marker && marker[0] === fence[0] && marker.length >= fence.length) fence = null
      continue
    }

    if (marker) {
      fence = marker
      continue
    }

    kept.push(line)
  }

  return kept
}
```

In `watchGuideLines`, wrap the initial split so the guide scan is fence-free too:

```js
  const lines = withoutFences(String(markdown).replace(/\r\n/g, "\n").split("\n"))
```

In `extractMoments`, wrap the fallback split the same way:

```js
  const allLines = withoutFences(String(markdown).replace(/\r\n/g, "\n").split("\n"))
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test tests/extension-markdown.test.ts tests/extension-moments.test.ts`
Expected: PASS, including every pre-existing test in both files.

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS — `tsc --noEmit`, `vite build`, all `node --test` files, and all Python tests.

- [ ] **Step 7: Commit**

```bash
git add extension/markdown.js extension/moments.js tests/extension-markdown.test.ts tests/extension-moments.test.ts
git commit -m "Keep diagrams from corrupting the panel and its seek bar"
```

---

## Self-review notes

Spec coverage: transport and placement (Task 4), the six-type contract (Task 4 prompt, Task 3 renderer), zero-is-correct defenses (Task 4), the render pipeline's five steps (Task 3), the `click` decision (Task 3 `securityLevel: "strict"` plus Task 4's prohibition), parse-failure fallback (Task 3), `linkifyTimecodes` fence-awareness (Task 1), renderer deduplication (Task 2), both extension hazards (Task 5), and every row of the spec's testing table.

Known gap, accepted: Mermaid rendering itself has no unit test. It is a third-party library behind a dynamic import, and jsdom does not render SVG layout, so a test would assert only that the mock was called. Task 3 Step 6 covers it by hand in the running app instead.
