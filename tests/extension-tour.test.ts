import assert from "node:assert/strict"
import test from "node:test"

import { DEFAULT_PERIOD_SECONDS, tourPlan, tourSeconds, tourStep } from "../extension/tour.js"

const moment = (startSeconds: number, endSeconds: number | null, label = "Why it matters") => ({
  startSeconds,
  endSeconds,
  label,
})

test("keeps the periods the model wrote", () => {
  assert.deepEqual(
    tourPlan([moment(60, 120), moment(300, 380)], { duration: 900 }),
    [
      { startSeconds: 60, endSeconds: 120, label: "Why it matters" },
      { startSeconds: 300, endSeconds: 380, label: "Why it matters" },
    ],
  )
})

test("gives a bare timecode a default period", () => {
  assert.deepEqual(tourPlan([moment(60, null)], { duration: 900 }), [
    { startSeconds: 60, endSeconds: 60 + DEFAULT_PERIOD_SECONDS, label: "Why it matters" },
  ])
})

test("clips a default period to the next moment", () => {
  const [first] = tourPlan([moment(60, null), moment(90, null)], { duration: 900 })

  assert.equal(first.endSeconds, 90)
})

test("clips a period to the end of the video", () => {
  assert.deepEqual(tourPlan([moment(880, 960)], { duration: 900 }), [
    { startSeconds: 880, endSeconds: 900, label: "Why it matters" },
  ])
})

test("drops a moment that starts past the end of the video", () => {
  assert.deepEqual(tourPlan([moment(60, 120), moment(1200, 1300)], { duration: 900 }), [
    { startSeconds: 60, endSeconds: 120, label: "Why it matters" },
  ])
})

test("orders the plan and keeps overlapping periods apart", () => {
  assert.deepEqual(tourPlan([moment(300, 400), moment(60, 320), moment(100, 150)], { duration: 900 }), [
    { startSeconds: 60, endSeconds: 100, label: "Why it matters" },
    { startSeconds: 100, endSeconds: 150, label: "Why it matters" },
    { startSeconds: 300, endSeconds: 400, label: "Why it matters" },
  ])
})

test("drops a period with nothing in it", () => {
  assert.deepEqual(tourPlan([moment(120, 120), moment(300, 400)], { duration: 900 }), [
    { startSeconds: 300, endSeconds: 400, label: "Why it matters" },
  ])
})

test("leaves the periods alone when the duration is not known yet", () => {
  assert.deepEqual(tourPlan([moment(60, null)], { duration: null }), [
    { startSeconds: 60, endSeconds: 60 + DEFAULT_PERIOD_SECONDS, label: "Why it matters" },
  ])
})

const plan = [
  { startSeconds: 60, endSeconds: 120, label: "First" },
  { startSeconds: 300, endSeconds: 360, label: "Second" },
  { startSeconds: 360, endSeconds: 400, label: "Third" },
]

test("stays put while the period is still playing", () => {
  assert.deepEqual(tourStep(plan, 0, 90), { index: 0, seekTo: null, done: false })
})

test("seeks to the next period when the current one ends", () => {
  assert.deepEqual(tourStep(plan, 0, 120), { index: 1, seekTo: 300, done: false })
})

test("does not seek between two periods written back to back", () => {
  assert.deepEqual(tourStep(plan, 1, 360), { index: 2, seekTo: null, done: false })
})

test("is done once the last period has played", () => {
  assert.deepEqual(tourStep(plan, 2, 400), { index: 3, seekTo: null, done: true })
})

test("skips forward when the viewer lands in a stretch nobody picked", () => {
  assert.deepEqual(tourStep(plan, 0, 200), { index: 1, seekTo: 300, done: false })
})

test("rejoins an earlier period when the viewer seeks backwards", () => {
  assert.deepEqual(tourStep(plan, 2, 90), { index: 0, seekTo: null, done: false })
})

test("pulls the playhead forward when the viewer seeks before the first period", () => {
  assert.deepEqual(tourStep(plan, 0, 5), { index: 0, seekTo: 60, done: false })
})

test("is done when there is nothing to play", () => {
  assert.deepEqual(tourStep([], 0, 0), { index: 0, seekTo: null, done: true })
})

test("adds up the watch time the tour actually costs", () => {
  assert.equal(tourSeconds(plan), 160)
  assert.equal(tourSeconds([]), 0)
})
