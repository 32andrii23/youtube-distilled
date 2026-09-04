// Reads the verdict the brief opens with: a 0-100 relevance score and the
// reason behind it. Kept out of the DOM-facing panel code, like moments.js, so
// the markdown the model actually writes can be covered without a browser.

const HEADING_PATTERN = /^(#{1,6})\s+(.+)$/
const FENCE_PATTERN = /^ {0,3}(`{3,}|~{3,})/
// Models reach for bold on a label they were told to write literally, and for
// an em dash where the prompt showed a colon. Both are the same line.
const LABEL = String.raw`[\s*_>-]*`
const SCORE_PATTERN = new RegExp(String.raw`^${LABEL}score${LABEL}\s*[:：—–-]\s*[*_]*\s*(\d{1,3})`, "im")
const REASON_PATTERN = new RegExp(String.raw`^${LABEL}why${LABEL}\s*[:：—–-]\s*[*_]*\s*(.+)$`, "ims")

// The bands the prompt scores against. Watching the video, watching only the
// guide moments, and reading the brief instead are three different actions, so
// the score has to land the reader on one of them rather than on a number.
const BANDS = [
  { floor: 70, tone: "watch", label: "Watch", note: "Worth your time in full" },
  { floor: 40, tone: "skim", label: "Skim", note: "Only the watch-guide moments" },
  { floor: 0, tone: "skip", label: "Skip", note: "The brief covers it" },
]

export function isVerdictHeading(title) {
  return /^(?:\d+[.)]\s*)?verdict\b/i.test(String(title).trim())
}

export function verdictBand(score) {
  return BANDS.find((band) => score >= band.floor) ?? BANDS.at(-1)
}

function bodyLines(markdown) {
  const lines = String(markdown).replace(/\r\n/g, "\n").split("\n")
  let fence = null
  let headingLevel = null
  let start = -1

  for (let index = 0; index < lines.length; index += 1) {
    const marker = FENCE_PATTERN.exec(lines[index])?.[1]
    if (fence) {
      if (marker && marker[0] === fence[0] && marker.length >= fence.length) fence = null
      continue
    }
    if (marker) {
      fence = marker
      continue
    }

    const heading = HEADING_PATTERN.exec(lines[index].trim())
    if (!heading) continue

    if (start < 0) {
      if (!isVerdictHeading(heading[2])) continue
      headingLevel = heading[1].length
      start = index + 1
      continue
    }

    if (heading[1].length <= headingLevel) return lines.slice(start, index)
  }

  return start < 0 ? null : lines.slice(start)
}

export function extractVerdict(markdown) {
  const lines = bodyLines(markdown)
  if (!lines) return null

  const body = lines.join("\n")
  const score = Number(SCORE_PATTERN.exec(body)?.[1])
  // A brief without a usable number is a brief with no verdict to show. The
  // sections below it are still worth reading, so this stays quiet.
  if (!Number.isInteger(score) || score < 0 || score > 100) return null

  const reason = (REASON_PATTERN.exec(body)?.[1] ?? "")
    .replace(/\s+/g, " ")
    // A model that wraps the whole line in bold leaves its closing run behind.
    .replace(/[*_\s]+$/, "")
    .trim()
  return { score, reason, ...verdictBand(score) }
}
