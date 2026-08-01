// What the panel knows about the videos it is distilling, minus the DOM that
// shows them. The panel holds one run per video, so these answer the question
// the single-run panel never had to: what is happening on the tabs you are not
// looking at.

// A finished brief on another tab is not work in progress, so only running ones
// count. The video on screen speaks for itself and is left out.
export function runsElsewhere(runs, shownVideoId) {
  return [...runs.values()].filter(
    (run) => run.state === "running" && run.video.videoId !== shownVideoId,
  ).length
}

export function describeRunsElsewhere(count) {
  if (count === 1) return "1 other video is distilling in another tab."
  return `${count} other videos are distilling in other tabs.`
}
