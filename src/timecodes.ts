const TIMECODE_PATTERN = /(?<![\w:/])((?:\d{1,2}:)?\d{1,2}:\d{2})(?:\s*[–—-]\s*((?:\d{1,2}:)?\d{1,2}:\d{2}))?/g

export function timecodeToSeconds(timecode: string) {
  return timecode.split(":").reduce((total, part) => total * 60 + Number(part), 0)
}

export function linkifyTimecodes(markdown: string) {
  return markdown.replace(
    TIMECODE_PATTERN,
    (match, start) => `[${match}](#t=${timecodeToSeconds(start)})`,
  )
}
