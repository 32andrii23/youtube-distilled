import assert from "node:assert/strict"
import test from "node:test"

import { describeRunsElsewhere, runsElsewhere } from "../extension/runs.js"

function runMap(entries: [string, string][]) {
  return new Map(
    entries.map(([videoId, state]) => [videoId, { video: { videoId }, state }]),
  )
}

test("counts only the running videos the panel is not showing", () => {
  const runs = runMap([
    ["aaaaaaaaaaa", "running"],
    ["bbbbbbbbbbb", "running"],
    ["ccccccccccc", "running"],
  ])

  assert.equal(runsElsewhere(runs, "aaaaaaaaaaa"), 2)
})

test("a finished or failed run is not work in progress", () => {
  const runs = runMap([
    ["aaaaaaaaaaa", "running"],
    ["bbbbbbbbbbb", "success"],
    ["ccccccccccc", "error"],
  ])

  assert.equal(runsElsewhere(runs, "aaaaaaaaaaa"), 0)
})

test("a run counts while its own tab is out of view", () => {
  const runs = runMap([["aaaaaaaaaaa", "running"]])

  assert.equal(runsElsewhere(runs, null), 1)
})

test("says how many, in the plural the count calls for", () => {
  assert.equal(describeRunsElsewhere(1), "1 other video is distilling in another tab.")
  assert.equal(describeRunsElsewhere(3), "3 other videos are distilling in other tabs.")
})
