// Plays the watch guide back: every period the model picked, in order, with
// everything it did not pick skipped. One button turns a forty-minute video
// into the four minutes of it that were worth watching.
//
// The stepping is a pure function of the plan and the playhead rather than a
// chain of timers. A timer would have to be cancelled and rebuilt on every
// pause, seek, and buffering stall; reading the playhead instead survives all
// three, and the same call that advances at the end of a period also recovers
// when the viewer drags the scrubber somewhere else entirely.
//
// content.js is a classic content script with no static imports, so it pulls
// this in the way it pulls grayscale.js.

// The prompt asks for periods, and rows almost always arrive as one. A bare
// timecode still has to end somewhere, and a minute is long enough to carry the
// point that earned the pick without eating the budget when a whole guide comes
// back written that way. It is a ceiling rather than a promise: the value below
// is clipped to the next period and to the end of the video.
export const DEFAULT_PERIOD_SECONDS = 60

// Turns the extracted moments into periods that can actually be played: every
// one with a real end, in ascending order, none overlapping the next, none
// running past the video.
export function tourPlan(moments, { duration = null, periodSeconds = DEFAULT_PERIOD_SECONDS } = {}) {
  const limit = Number.isFinite(duration) && duration > 0 ? duration : Infinity
  const ordered = [...moments].sort((left, right) => left.startSeconds - right.startSeconds)

  return ordered.flatMap((moment, index) => {
    const startSeconds = moment.startSeconds
    const proposed = moment.endSeconds === null || moment.endSeconds === undefined
      ? startSeconds + periodSeconds
      : moment.endSeconds

    // Two periods that overlap would play the same stretch twice and light two
    // markers at once, and a period reaching past the end of the video would
    // never finish. Clipping is also what drops a moment the model placed
    // beyond the runtime: its end lands at or before its own start.
    const endSeconds = Math.min(proposed, ordered[index + 1]?.startSeconds ?? Infinity, limit)
    if (!(endSeconds > startSeconds)) return []
    return [{ startSeconds, endSeconds, label: moment.label }]
  })
}

// What the driver should do next, given where the playhead actually is. The
// index is a hint rather than a source of truth: once the playhead has left the
// period it names — because the period ended, or because the viewer seeked —
// the answer is re-derived from the time alone.
export function tourStep(plan, index, seconds) {
  const current = plan[index]
  if (current && seconds >= current.startSeconds && seconds < current.endSeconds) {
    return { index, seekTo: null, done: false }
  }

  // The first period that has not finished yet. Seeking backwards into an
  // earlier one therefore rejoins the tour there instead of ending it, and
  // landing in a stretch nobody picked jumps forward to the next period.
  const next = plan.findIndex((period) => period.endSeconds > seconds)
  if (next < 0) return { index: plan.length, seekTo: null, done: true }

  // Periods the model wrote back to back need no seek: playback is already
  // inside the next one, and seeking would stutter the picture for nothing.
  const target = plan[next]
  return {
    index: next,
    seekTo: seconds < target.startSeconds ? target.startSeconds : null,
    done: false,
  }
}

// How long the whole tour runs, which is the number the watch guide is really
// promising and the one worth showing next to the button.
export function tourSeconds(plan) {
  return plan.reduce((total, period) => total + (period.endSeconds - period.startSeconds), 0)
}
