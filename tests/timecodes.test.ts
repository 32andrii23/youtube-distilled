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

test("leaves timecodes inside a fenced block alone", () => {
  const markdown = ["Watch 01:00 first.", "", "```mermaid", "timeline", "  01:00 : Intro", "```", "", "Then 02:00."].join("\n")

  assert.equal(
    linkifyTimecodes(markdown),
    ["Watch [01:00](#t=60) first.", "", "```mermaid", "timeline", "  01:00 : Intro", "```", "", "Then [02:00](#t=120)."].join("\n"),
  )
})

test("leaves an unterminated fence alone to the end of the document", () => {
  const markdown = ["```mermaid", "timeline", "  03:00 : Cut off"].join("\n")

  assert.equal(linkifyTimecodes(markdown), markdown)
})

test("leaves timecodes inside an inline code span alone", () => {
  assert.equal(linkifyTimecodes("Use `01:00` literally, seek 02:00."), "Use `01:00` literally, seek [02:00](#t=120).")
})

test("closes a fence only on a matching marker", () => {
  const markdown = ["~~~mermaid", "timeline", "  04:00 : Still fenced", "```", "  05:00 : Also fenced", "~~~", "", "Free 06:00."].join("\n")

  assert.equal(
    linkifyTimecodes(markdown),
    ["~~~mermaid", "timeline", "  04:00 : Still fenced", "```", "  05:00 : Also fenced", "~~~", "", "Free [06:00](#t=360)."].join("\n"),
  )
})
