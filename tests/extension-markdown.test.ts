import assert from "node:assert/strict"
import test from "node:test"

import { escapeHtml, renderMarkdown, splitSummary, timecodeToSeconds } from "../extension/markdown.js"
import { cleanVideoTitle, formatDuration, formatElapsed, formatStepDuration } from "../extension/format.js"
import { isSelectableProvider, normalizeSettings } from "../extension/provider-catalog.js"

test("renders headings below the section level", () => {
  assert.equal(renderMarkdown("### Concepts"), "<h3>Concepts</h3>")
  assert.equal(renderMarkdown("#### Detail"), "<h4>Detail</h4>")
})

test("joins wrapped lines into a single paragraph", () => {
  assert.equal(renderMarkdown("one line\nsecond line"), "<p>one line second line</p>")
})

test("renders unordered and ordered lists", () => {
  assert.equal(renderMarkdown("- first\n- second"), "<ul><li>first</li><li>second</li></ul>")
  assert.equal(renderMarkdown("1. first\n2. second"), "<ol><li>first</li><li>second</li></ol>")
})

test("keeps a hard-wrapped list item as one item", () => {
  assert.equal(
    renderMarkdown("- a claim that runs\n  onto a second line\n- a shorter one"),
    "<ul><li>a claim that runs onto a second line</li><li>a shorter one</li></ul>",
  )
})

test("does not end a list at a single blank line between items", () => {
  assert.equal(
    renderMarkdown("- first\n\n- second"),
    "<ul><li>first</li><li>second</li></ul>",
  )
})

test("ends a list when prose follows a blank line", () => {
  assert.equal(
    renderMarkdown("- only item\n\nAfterwards, prose."),
    "<ul><li>only item</li></ul><p>Afterwards, prose.</p>",
  )
})

test("renders bold and inline code", () => {
  assert.equal(renderMarkdown("**waiting** costs"), "<p><strong>waiting</strong> costs</p>")
  assert.equal(renderMarkdown("run `opened` first"), "<p>run <code>opened</code> first</p>")
})

test("renders a GFM table with a head and a body", () => {
  const html = renderMarkdown("| Moment | Why |\n| --- | --- |\n| Intro | Framing |")
  assert.equal(
    html,
    "<table><thead><tr><th>Moment</th><th>Why</th></tr></thead>"
      + "<tbody><tr><td>Intro</td><td>Framing</td></tr></tbody></table>",
  )
})

test("renders a multi-line blockquote as one paragraph", () => {
  assert.equal(
    renderMarkdown("> we asked twelve\n> engineers"),
    "<blockquote><p>we asked twelve engineers</p></blockquote>",
  )
})

test("escapes markup so source text cannot become HTML", () => {
  const html = renderMarkdown("<script>alert(1)</script>")
  assert.ok(!html.includes("<script>"))
  assert.ok(html.includes("&lt;script&gt;"))
})

test("escapes the five HTML-significant characters", () => {
  assert.equal(escapeHtml(`<&>"'`), "&lt;&amp;&gt;&quot;&#39;")
})

test("converts short and hour-long timecodes to seconds", () => {
  assert.equal(timecodeToSeconds("01:30"), 90)
  assert.equal(timecodeToSeconds("1:02:03"), 3723)
})

test("turns a bare timecode into a seek button", () => {
  assert.equal(
    renderMarkdown("see 12:34 for the demo"),
    '<p>see <button type="button" class="timecode-link" data-seconds="754">12:34</button> for the demo</p>',
  )
})

test("anchors a timecode range at its starting second", () => {
  const html = renderMarkdown("04:12–07:40 covers it")
  assert.ok(html.includes('data-seconds="252"'))
  assert.ok(html.includes(">04:12–07:40</button>"))
})

test("does not treat a URL port as a timecode", () => {
  const html = renderMarkdown("visit http://localhost:4321 now")
  assert.ok(!html.includes("timecode-link"))
  assert.ok(html.includes("localhost:4321"))
})

test("renders a markdown link and rejects an unsafe scheme", () => {
  assert.equal(
    renderMarkdown("[primer](https://example.com/a)"),
    '<p><a href="https://example.com/a" target="_blank" rel="noreferrer">primer</a></p>',
  )
  const unsafe = renderMarkdown("[tap](javascript:alert(1))")
  assert.ok(!unsafe.includes("<a "))
})

test("keeps a timecode link clickable when written as a markdown link", () => {
  const html = renderMarkdown("[12:34](#t=754)")
  assert.ok(html.includes("timecode-link"))
  assert.ok(html.includes('data-seconds="754"'))
})

test("splits a brief on its section headings", () => {
  const sections = splitSummary("## 1. Video summary\nbody one\n\n## Key takeaways\nbody two")
  assert.equal(sections.length, 2)
  assert.equal(sections[0].title, "Video summary")
  assert.equal(sections[0].content, "body one")
  assert.equal(sections[1].title, "Key takeaways")
})

test("treats a brief with no headings as one section", () => {
  const sections = splitSummary("just prose")
  assert.deepEqual(sections, [{ title: "Video brief", content: "just prose" }])
})

test("strips the unread count and site suffix from a tab title", () => {
  assert.equal(cleanVideoTitle("(3) Real Title - YouTube"), "Real Title")
  assert.equal(cleanVideoTitle("Real Title — YouTube"), "Real Title")
  assert.equal(cleanVideoTitle(null), "")
})

test("formats durations the way the app does", () => {
  assert.equal(formatElapsed(7), "7s")
  assert.equal(formatElapsed(134), "2m 14s")
  assert.equal(formatStepDuration(6.17), "6.2s")
  assert.equal(formatStepDuration(134), "2m 14s")
})

test("formats a video length as a clock reading", () => {
  assert.equal(formatDuration(95), "1:35")
  assert.equal(formatDuration(3725), "1:02:05")
  assert.equal(formatDuration(0), "")
})

test("normalizes settings to an available provider and its supported reasoning", () => {
  const catalog = {
    codex: { available: false, models: [{ id: "codex-model", reasoning: ["low"], default_reasoning: "low" }] },
    claude: { available: true, models: [{ id: "claude-model", reasoning: ["default"], default_reasoning: "default" }] },
  }
  assert.deepEqual(normalizeSettings({ provider: "codex", model: "codex-model", reasoning: "high" }, catalog), {
    provider: "claude", model: "claude-model", reasoning: "default",
  })
  assert.equal(isSelectableProvider(catalog, "codex"), false)
  assert.equal(isSelectableProvider(catalog, "claude"), true)
})

test("renders a fenced block as code without linkifying its timecodes", () => {
  const markdown = ["```sh", "youtube-distilled 01:00", "```"].join("\n")

  assert.equal(
    renderMarkdown(markdown),
    "<pre><code>youtube-distilled 01:00</code></pre>",
  )
})

// diagrams.js draws over this placeholder once mermaid has loaded, reading the
// source back out of it. Its timecodes must not be linkified either: they are
// diagram syntax here, and become seek controls only on the drawn labels.
test("renders a mermaid fence as a diagram placeholder holding its source", () => {
  const markdown = ["```mermaid", "timeline", "  Opening claim : 01:00", "```"].join("\n")

  assert.equal(
    renderMarkdown(markdown),
    '<div class="diagram"><pre class="diagram-source"><code>timeline\n'
    + "  Opening claim : 01:00</code></pre></div>",
  )
})

test("treats a mermaid fence as a diagram whatever the case and spacing", () => {
  for (const info of ["mermaid", "Mermaid", "mermaid ", " MERMAID"]) {
    assert.match(renderMarkdown(["```" + info, "graph TD", "```"].join("\n")), /class="diagram"/)
  }
})

test("escapes html inside a diagram placeholder", () => {
  const markdown = ["```mermaid", "graph TD; a[\"<img src=x>\"]", "```"].join("\n")

  assert.equal(
    renderMarkdown(markdown),
    '<div class="diagram"><pre class="diagram-source"><code>graph TD; a[&quot;&lt;img src=x&gt;&quot;]'
    + "</code></pre></div>",
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

  assert.match(
    renderMarkdown(markdown),
    /<pre><code>code 01:00<\/code><\/pre><p>Then <button[^>]*data-seconds="120"/,
  )
})
