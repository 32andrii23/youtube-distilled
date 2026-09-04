// Extracts the high-value watch moments from a finished brief. This stays
// separate from the DOM-facing panel code so the markdown edge cases can be
// covered without a browser.

import { TIMECODE_PATTERN, timecodeToSeconds } from "./markdown.js"

const HEADING_PATTERN = /^(#{1,6})\s+(.+)$/
const FENCE_PATTERN = /^ {0,3}(`{3,}|~{3,})/
const TABLE_DIVIDER_CELL_PATTERN = /^:?-{3,}:?$/
// The guide opens with the total watch time it adds up to. Written as words
// that is inert, but a model that writes "Total: 4:30" would otherwise plant a
// marker at 4:30 that nobody picked.
const TOTAL_LINE_PATTERN = /^[\s\-–—*_>]*total\b/i
const LABEL_LIMIT = 80

function timecodeMatches(text) {
  return [...String(text).matchAll(TIMECODE_PATTERN)]
}

function stripMarkdown(text) {
  return String(text)
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\[[^\]]*\]/g, "$1")
    .replace(/\[([^\]]+)\]/g, "$1")
    .replace(/[*_~`#>]/g, "")
}

function truncateLabel(label) {
  if (label.length <= LABEL_LIMIT) return label

  const available = LABEL_LIMIT - 1
  const prefix = label.slice(0, available + 1)
  const boundary = prefix.lastIndexOf(" ")
  return `${label.slice(0, boundary > 0 ? boundary : available).trimEnd()}…`
}

function cleanLabel(source) {
  let label = stripMarkdown(source).replace(/\s+/g, " ").trim()

  // Bullets, ordered-list markers, table edges, and separators left behind
  // after removing a leading timecode are presentation, not explanation.
  let previous
  do {
    previous = label
    label = label
      .replace(/^\d+[.)]\s*/, "")
      .replace(/^[\s\-–—:;,.|+•]+/, "")
      .trim()
  } while (label !== previous)

  return truncateLabel(label)
}

function momentFromMatch(match, labelSource) {
  return {
    startSeconds: timecodeToSeconds(match[1]),
    endSeconds: match[2] ? timecodeToSeconds(match[2]) : null,
    label: cleanLabel(labelSource),
  }
}

function momentsFromLine(line) {
  const matches = timecodeMatches(line)
  if (!matches.length) return []

  const labelSource = line.replace(TIMECODE_PATTERN, " ").replace(/\s+[:;,.]\s+/g, " ")
  return matches.map((match) => momentFromMatch(match, labelSource))
}

function tableCells(line) {
  return line
    .trim()
    .replace(/^\||\|$/g, "")
    .split(/(?<!\\)\|/)
    .map((cell) => cell.replace(/\\\|/g, "|").trim())
}

function isTableDivider(line) {
  const cells = tableCells(line)
  return cells.length > 1 && cells.every((cell) => TABLE_DIVIDER_CELL_PATTERN.test(cell.replace(/\s/g, "")))
}

function tableMoments(lines) {
  const moments = []
  const consumed = new Set()

  for (let index = 0; index + 1 < lines.length; index += 1) {
    if (!lines[index].includes("|") || !isTableDivider(lines[index + 1])) continue

    consumed.add(index)
    consumed.add(index + 1)
    let rowIndex = index + 2
    while (rowIndex < lines.length && lines[rowIndex].includes("|")) {
      consumed.add(rowIndex)
      const cells = tableCells(lines[rowIndex])

      // The watch-guide contract puts the timestamp in the first cell. The
      // current backend prompt still uses a Title | Time | Why variant, so a
      // later timestamp cell is accepted when the first cell has none.
      const firstCellMatch = timecodeMatches(cells[0] ?? "")[0]
      const match = firstCellMatch ?? cells.flatMap(timecodeMatches)[0]
      if (match) {
        const lastCell = cells.at(-1) ?? ""
        const middleCell = cells[Math.floor(cells.length / 2)] ?? ""
        const labelSource = cleanLabel(lastCell) ? lastCell : middleCell
        moments.push(momentFromMatch(match, labelSource))
      }
      rowIndex += 1
    }
    index = rowIndex - 1
  }

  return { moments, consumed }
}

// A timeline diagram is dense with timecodes, and the whole-brief fallback below
// would otherwise read its labels as watch moments and mark the seek bar with
// times nobody chose.
function withoutFences(lines) {
  const kept = []
  let fence = null

  for (const line of lines) {
    const marker = FENCE_PATTERN.exec(line)?.[1]

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

function briefLines(markdown) {
  return withoutFences(String(markdown).replace(/\r\n/g, "\n").split("\n"))
}

function watchGuideLines(markdown) {
  const lines = briefLines(markdown)
  let headingLevel = null
  const headingIndex = lines.findIndex((line) => {
    const heading = HEADING_PATTERN.exec(line.trim())
    if (!heading || !/10 minutes/i.test(heading[2])) return false
    headingLevel = heading[1].length
    return true
  })
  if (headingIndex < 0) return null

  let end = lines.length
  for (let index = headingIndex + 1; index < lines.length; index += 1) {
    const heading = HEADING_PATTERN.exec(lines[index].trim())
    if (heading && heading[1].length <= headingLevel) {
      end = index
      break
    }
  }
  return lines.slice(headingIndex + 1, end).filter((line) => !TOTAL_LINE_PATTERN.test(line))
}

function momentsFromLines(lines) {
  return lines.flatMap(momentsFromLine)
}

// The model picks the moments row by row, so two of them can claim overlapping
// stretches of the video. On the seek bar that draws brackets on top of each
// other with hit areas that fight, so an earlier range ends where the next
// moment starts. Clipping keeps every pick and every start time, which is what
// the marker actually seeks to.
function disjoint(moments) {
  return moments.map((moment, index) => {
    const nextStart = moments[index + 1]?.startSeconds
    if (moment.endSeconds === null || nextStart === undefined) return moment
    if (moment.endSeconds <= nextStart) return moment
    return { ...moment, endSeconds: nextStart }
  })
}

function finish(moments) {
  const seen = new Set()
  const ordered = moments
    .filter((moment) => moment.label)
    .filter((moment) => {
      if (seen.has(moment.startSeconds)) return false
      seen.add(moment.startSeconds)
      return true
    })
    .sort((left, right) => left.startSeconds - right.startSeconds)

  // Starts are unique and ascending by here, so clipping to the next start
  // always leaves a range that still begins before it ends.
  return disjoint(ordered)
}

export function extractMoments(markdown) {
  const guideLines = watchGuideLines(markdown)
  if (guideLines) {
    const table = tableMoments(guideLines)
    const prose = momentsFromLines(guideLines.filter((_line, index) => !table.consumed.has(index)))
    const guideMoments = finish([...table.moments, ...prose])
    if (guideMoments.length) return guideMoments
  }

  return finish(momentsFromLines(briefLines(markdown)))
}
