// Pure formatting helpers. formatElapsed and formatStepDuration match the app's
// versions in src/App.tsx so both surfaces render durations identically.

const UNREAD_COUNT_PREFIX = /^\(\d+\)\s*/
const YOUTUBE_TITLE_SUFFIX = /\s*[-–—]\s*YouTube\s*$/

export function formatElapsed(seconds) {
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`
}

export function formatStepDuration(seconds) {
  if (seconds < 10) return `${seconds.toFixed(1)}s`
  return formatElapsed(Math.round(seconds))
}

export function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return ""

  const whole = Math.round(seconds)
  const hours = Math.floor(whole / 3600)
  const minutes = Math.floor((whole % 3600) / 60)
  const remainder = String(whole % 60).padStart(2, "0")

  if (!hours) return `${minutes}:${remainder}`
  return `${hours}:${String(minutes).padStart(2, "0")}:${remainder}`
}

// A YouTube tab title arrives as "(3) Real Title - YouTube". Strip both ends.
export function cleanVideoTitle(documentTitle) {
  return String(documentTitle ?? "")
    .replace(UNREAD_COUNT_PREFIX, "")
    .replace(YOUTUBE_TITLE_SUFFIX, "")
    .trim()
}
