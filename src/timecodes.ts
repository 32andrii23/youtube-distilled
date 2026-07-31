export const TIMECODE_PATTERN = /(?<![\w:/])((?:\d{1,2}:)?\d{1,2}:\d{2})(?:\s*[–—-]\s*((?:\d{1,2}:)?\d{1,2}:\d{2}))?/g

// A fence opens on three or more backticks or tildes, indented no more than
// three spaces, and closes only on the same character repeated at least as many
// times. Diagrams live inside these, so nothing in here may be rewritten.
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
