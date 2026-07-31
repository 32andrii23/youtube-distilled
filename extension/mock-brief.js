// SAMPLE DATA. This brief was not generated from any video. It exists so the
// panel can be built and judged before the local API is wired in.
//
// The exported payload is shaped exactly like SummaryResponse in backend/main.py
// (summary, video_url, elapsed_seconds, provider, model, reasoning, timings), so
// replacing createMockBrief with a fetch to /api/summarize is the whole job when
// the time comes. The prose deliberately exercises every markdown path the
// renderer supports: headings, bullets, an ordered list, bold, inline code, a
// blockquote, a table, a link, and timecodes in several formats.

const SAMPLE_SUMMARY = `## Video summary

The talk argues that most engineering teams misdiagnose their own slowness. The
speaker's claim is that delay is rarely caused by typing speed or tooling, and is
almost always caused by **waiting** — for review, for environments, for a
decision nobody owns. The first third builds the case with queue theory, the
middle third walks through three team retrospectives, and the last third offers a
measurement recipe that any team can run in a week.

The argument is strongest when it stays concrete. Where it thins out is the jump
from queueing models to human behaviour, which is asserted more than shown.

## Key takeaways

- Utilisation above roughly 80% makes queue length grow non-linearly, so a fully
  booked team is a slow team by construction — see [12:34](#t=754).
- Cycle time is a better health signal than velocity because it cannot be
  inflated by redefining the unit of work.
- Batching is the hidden cost: a review queue that runs twice a day sets a floor
  on delivery time no amount of individual effort can beat.
- Ownership ambiguity produces the longest single delays measured across the
  three retrospectives — one decision sat for eleven days.
- The recommended instrument is boring on purpose: timestamp four transitions per
  change and plot the gaps.

## I only have 10 minutes

| Moment | What you get | Why it matters |
| --- | --- | --- |
| 04:12–07:40 | The queue theory core | The one idea the rest depends on |
| 12:34 | Utilisation demonstration | Makes the non-linearity concrete |
| 23:05–26:18 | The eleven-day decision | The most useful war story |
| 41:50 | The measurement recipe | What you would actually do Monday |

Watch those four and you have the argument. The opening ten minutes are framing
and can be skipped without loss.

## Important concepts and terms

1. **Little's Law** — average queue length equals arrival rate multiplied by
   average wait. Introduced at 06:20 and used throughout.
2. **Cycle time** — elapsed time from starting a change to shipping it, as
   distinct from effort spent.
3. **Batch size** — how much work moves through a step at once. The speaker
   treats review cadence as a batching decision.
4. **Work in progress limit** — a cap on concurrent changes, presented as the
   cheapest available intervention.

## Hidden value

The most valuable segment is the least advertised. At [23:05](#t=1385) the speaker
walks through an internal audit where the team's own estimate of their bottleneck
was wrong by an order of magnitude.

> We asked twelve engineers where the time went. Every one of them named a step
> that accounted for under four percent of it.

Also easy to miss: a throwaway remark at 38:02 that the measurement script is
under a hundred lines, and that teams should resist the urge to buy a dashboard
before they have looked at the raw numbers once.

## Practical use

Run the instrument before changing anything. Concretely, for two weeks, record
four timestamps per change — \`opened\`, \`review_started\`, \`review_done\`,
\`deployed\` — and plot the gaps rather than the durations.

If one gap dominates, you have found the constraint and the rest of the talk's
advice becomes optional. If no gap dominates, the speaker's own conclusion at
[45:30](#t=2730) applies: the problem is not flow, and you should look at scope
instead.

Further reading is linked in the description, including the original
[queueing primer](https://example.com/queueing-primer) the talk leans on.`

const SAMPLE_TIMINGS = [
  { label: "Video context", seconds: 3.4 },
  { label: "Transcript", seconds: 6.1 },
  { label: "Analysis", seconds: 118.2 },
  { label: "Formatting", seconds: 6.3 },
]

// Scales the sample step timings onto however long the simulated run actually
// took, so the headline figure and the breakdown never contradict each other.
export function scaleTimings(timings, elapsedSeconds) {
  const total = timings.reduce((sum, timing) => sum + timing.seconds, 0)
  if (!total) return timings.map((timing) => ({ ...timing, seconds: 0 }))

  return timings.map((timing) => ({
    label: timing.label,
    seconds: (timing.seconds / total) * elapsedSeconds,
  }))
}

export function createMockBrief({ videoId, settings, elapsedSeconds }) {
  return {
    summary: SAMPLE_SUMMARY,
    video_url: videoId ? `https://www.youtube.com/watch?v=${videoId}` : "",
    elapsed_seconds: Math.max(1, Math.round(elapsedSeconds)),
    provider: settings.provider,
    model: settings.model,
    reasoning: settings.reasoning,
    timings: scaleTimings(SAMPLE_TIMINGS, Math.max(1, elapsedSeconds)),
  }
}
