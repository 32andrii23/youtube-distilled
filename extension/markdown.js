// A markdown renderer for exactly the subset a brief uses: headings, lists,
// bold, inline code, links, blockquotes, and GFM tables. Small enough to read in
// one sitting, which is the point of shipping the panel without a build step.
//
// Every fragment of source text is escaped before it becomes HTML. Timecodes
// render as buttons carrying the second they point at, which is how the panel
// drives the YouTube player.

const HOLD_MARK = "\u0000"

const ESCAPE_MAP = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
}

// Kept in step with src/timecodes.ts so both surfaces agree on what counts as a
// timestamp. The lookbehind is what stops it matching a URL port.
export const TIMECODE_PATTERN =
  /(?<![\w:/])((?:\d{1,2}:)?\d{1,2}:\d{2})(?:\s*[–—-]\s*((?:\d{1,2}:)?\d{1,2}:\d{2}))?/g
const HEADING_PATTERN = /^(#{2,4})\s+(.*)$/
const UNORDERED_ITEM_PATTERN = /^\s*[-*]\s+(.*)$/
const ORDERED_ITEM_PATTERN = /^\s*\d+\.\s+(.*)$/
const TABLE_DIVIDER_PATTERN = /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/
const CODE_SPAN_PATTERN = /`([^`]+)`/g
const LINK_PATTERN = /\[([^\]]+)\]\(([^)\s]+)\)/g
const BOLD_PATTERN = /\*\*([^*]+)\*\*/g
const SAFE_HREF_PATTERN = /^(https?:\/\/|mailto:|#)/i
const PLACEHOLDER_PATTERN = new RegExp(`${HOLD_MARK}(\\d+)${HOLD_MARK}`, "g")

export function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (character) => ESCAPE_MAP[character])
}

export function timecodeToSeconds(timecode) {
  return timecode.split(":").reduce((total, part) => total * 60 + Number(part), 0)
}

function timecodeButton(label, seconds) {
  return `<button type="button" class="timecode-link" data-seconds="${seconds}">${label}</button>`
}

// Renders one line of inline markup. Code spans and finished links are held
// aside as placeholders so that later passes cannot reach inside them.
function renderInline(source) {
  const held = []
  const hold = (html) => {
    held.push(html)
    return `${HOLD_MARK}${held.length - 1}${HOLD_MARK}`
  }

  let text = escapeHtml(source)

  text = text.replace(CODE_SPAN_PATTERN, (_match, code) => hold(`<code>${code}</code>`))

  text = text.replace(LINK_PATTERN, (match, label, href) => {
    // The app's linkifyTimecodes emits "#t=<seconds>" links, and briefs are
    // written that way too. Treat them as seek buttons, not anchors.
    if (href.startsWith("#t=")) return hold(timecodeButton(label, Number(href.slice(3))))
    if (!SAFE_HREF_PATTERN.test(href)) return match
    return hold(`<a href="${href}" target="_blank" rel="noreferrer">${label}</a>`)
  })

  text = text.replace(BOLD_PATTERN, (_match, bold) => `<strong>${bold}</strong>`)

  text = text.replace(TIMECODE_PATTERN, (match, start) =>
    hold(timecodeButton(match, timecodeToSeconds(start))),
  )

  // Held fragments can nest — a code span inside a link label — so keep
  // restoring until no placeholders remain.
  while (text.includes(HOLD_MARK)) {
    text = text.replace(PLACEHOLDER_PATTERN, (_match, index) => held[Number(index)])
  }
  return text
}

function renderCells(line, tag) {
  return line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((cell) => `<${tag}>${renderInline(cell.trim())}</${tag}>`)
    .join("")
}

function renderTable(lines, start) {
  const rows = []
  let index = start + 2
  while (index < lines.length && lines[index].includes("|")) {
    rows.push(renderCells(lines[index], "td"))
    index += 1
  }

  const head = `<thead><tr>${renderCells(lines[start], "th")}</tr></thead>`
  const body = rows.length ? `<tbody>${rows.map((row) => `<tr>${row}</tr>`).join("")}</tbody>` : ""
  return { html: `<table>${head}${body}</table>`, next: index }
}

function renderList(lines, start, pattern, tag) {
  const items = []
  let index = start

  while (index < lines.length) {
    const match = pattern.exec(lines[index])
    if (!match) break

    // A wrapped line belongs to the item above it, and a single blank line
    // between items does not end the list. Briefs are hard-wrapped, so getting
    // this wrong would split every bullet into a list of its own.
    const parts = [match[1]]
    index += 1
    while (index < lines.length && lines[index].trim() && !isBlockStart(lines, index)) {
      parts.push(lines[index].trim())
      index += 1
    }
    items.push(`<li>${renderInline(parts.join(" "))}</li>`)

    if (
      index + 1 < lines.length
      && !lines[index].trim()
      && pattern.test(lines[index + 1])
    ) {
      index += 1
    }
  }

  return { html: `<${tag}>${items.join("")}</${tag}>`, next: index }
}

function renderBlockquote(lines, start) {
  const quoted = []
  let index = start
  while (index < lines.length && lines[index].trimStart().startsWith(">")) {
    quoted.push(lines[index].trimStart().replace(/^>\s?/, ""))
    index += 1
  }
  return { html: `<blockquote><p>${renderInline(quoted.join(" "))}</p></blockquote>`, next: index }
}

function renderParagraph(lines, start) {
  const collected = []
  let index = start
  while (index < lines.length && lines[index].trim() && !isBlockStart(lines, index)) {
    collected.push(lines[index].trim())
    index += 1
  }
  return { html: `<p>${renderInline(collected.join(" "))}</p>`, next: index }
}

function isTableStart(lines, index) {
  return (
    lines[index].includes("|")
    && index + 1 < lines.length
    && TABLE_DIVIDER_PATTERN.test(lines[index + 1])
  )
}

function isBlockStart(lines, index) {
  const line = lines[index]
  return (
    HEADING_PATTERN.test(line)
    || UNORDERED_ITEM_PATTERN.test(line)
    || ORDERED_ITEM_PATTERN.test(line)
    || line.trimStart().startsWith(">")
    || isTableStart(lines, index)
  )
}

export function renderMarkdown(markdown) {
  const lines = String(markdown).replace(/\r\n/g, "\n").split("\n")
  const html = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index]

    if (!line.trim()) {
      index += 1
      continue
    }

    const heading = HEADING_PATTERN.exec(line)
    if (heading) {
      // Only h3 and h4 are styled, so "##" — which the section splitter would
      // normally have consumed — is clamped up into range.
      const level = Math.min(Math.max(heading[1].length, 3), 4)
      html.push(`<h${level}>${renderInline(heading[2])}</h${level}>`)
      index += 1
      continue
    }

    let block
    if (isTableStart(lines, index)) block = renderTable(lines, index)
    else if (line.trimStart().startsWith(">")) block = renderBlockquote(lines, index)
    else if (UNORDERED_ITEM_PATTERN.test(line)) block = renderList(lines, index, UNORDERED_ITEM_PATTERN, "ul")
    else if (ORDERED_ITEM_PATTERN.test(line)) block = renderList(lines, index, ORDERED_ITEM_PATTERN, "ol")
    else block = renderParagraph(lines, index)

    html.push(block.html)
    index = block.next
  }

  return html.join("")
}

// Mirrors splitSummary in src/App.tsx: a brief is a run of "## " sections.
export function splitSummary(markdown) {
  const matches = [...String(markdown).matchAll(/^##\s+(.+)$/gm)]
  if (!matches.length) return [{ title: "Video brief", content: String(markdown).trim() }]

  return matches.map((match, index) => {
    const start = (match.index ?? 0) + match[0].length
    const end = matches[index + 1]?.index ?? markdown.length
    return {
      title: match[1].replace(/^\d+\.\s*/, "").trim(),
      content: markdown.slice(start, end).trim(),
    }
  })
}
