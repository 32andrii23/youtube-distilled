import assert from "node:assert/strict"
import test from "node:test"

import { linkifyTimecodes, timecodeToSeconds } from "../src/timecodes.ts"

test("converts short and hour-long timecodes to seconds", () => {
  assert.equal(timecodeToSeconds("01:30"), 90)
  assert.equal(timecodeToSeconds("1:02:03"), 3723)
})

test("links a time range at its starting timestamp", () => {
  assert.equal(
    linkifyTimecodes("| Core idea | 12:34–14:05 | Why it matters |"),
    "| Core idea | [12:34–14:05](#t=754) | Why it matters |",
  )
})

test("does not treat URL ports as timestamps", () => {
  assert.equal(linkifyTimecodes("http://localhost:4321"), "http://localhost:4321")
})
