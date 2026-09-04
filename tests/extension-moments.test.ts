import assert from "node:assert/strict"
import test from "node:test"

import { extractMoments } from "../extension/moments.js"

test("extracts table guide moments using the last cell as the reason", () => {
  const brief = `
## Summary
An earlier mention at 00:15 is not part of the guide.

## I ONLY HAVE 10 MINUTES — Watch Guide
| Moment | What you get | Why it matters |
| --- | --- | --- |
| 04:12 | Product demo | **Shows the workflow** end to end |
| 12:30 | Trade-offs | Explains the decision |

## Practical use
Later section at 20:00.
`

  assert.deepEqual(extractMoments(brief), [
    { startSeconds: 252, endSeconds: null, label: "Shows the workflow end to end" },
    { startSeconds: 750, endSeconds: null, label: "Explains the decision" },
  ])
})

test("extracts bullet and prose guide moments", () => {
  const brief = `
## I only have 10 minutes
- 01:05 — The framing that makes the rest click
At 03:20: a compact live demonstration
## Next section
09:00 should not be included
`

  assert.deepEqual(extractMoments(brief), [
    { startSeconds: 65, endSeconds: null, label: "The framing that makes the rest click" },
    { startSeconds: 200, endSeconds: null, label: "At a compact live demonstration" },
  ])
})

test("preserves the end of a timecode range", () => {
  const brief = `
## 10 Minutes Watch Guide
| Moment | What you get | Why it matters |
| --- | --- | --- |
| 04:12–07:40 | A worked example | Makes the abstract method concrete |
`

  assert.deepEqual(extractMoments(brief), [
    { startSeconds: 252, endSeconds: 460, label: "Makes the abstract method concrete" },
  ])
})

test("clips overlapping and nested periods so the ranges stay disjoint", () => {
  const brief = `
## I only have 10 minutes
| Title | Time | Why this part matters |
| --- | ---: | --- |
| Setup | 01:00–05:00 | Frames the problem |
| Method | 03:00–04:00 | Nested inside the setup range |
| Payoff | 03:30–06:00 | Overlaps the method range |
`

  assert.deepEqual(extractMoments(brief), [
    { startSeconds: 60, endSeconds: 180, label: "Frames the problem" },
    { startSeconds: 180, endSeconds: 210, label: "Nested inside the setup range" },
    { startSeconds: 210, endSeconds: 360, label: "Overlaps the method range" },
  ])
})

test("falls back to every timecode when the guide has none", () => {
  const brief = `
## I only have 10 minutes
No supported timestamps were available.
## Notes
- 09:30 — First useful explanation
- 02:00 — Useful setup
`

  assert.deepEqual(extractMoments(brief), [
    { startSeconds: 120, endSeconds: null, label: "Useful setup" },
    { startSeconds: 570, endSeconds: null, label: "First useful explanation" },
  ])
})

test("strips markdown while keeping visible link text", () => {
  const brief = `
## My 10 Minutes
- **01:02** — Watch the \`live demo\` and [clear explanation](https://example.com)
`

  assert.deepEqual(extractMoments(brief), [
    { startSeconds: 62, endSeconds: null, label: "Watch the live demo and clear explanation" },
  ])
})

test("truncates labels to 80 characters on a word boundary", () => {
  const brief = `
## 10 minutes
- 00:10 — This explanation connects every important premise before demonstrating the final practical workflow in detail
`
  const [moment] = extractMoments(brief)

  assert.equal(moment.label, "This explanation connects every important premise before demonstrating the…")
  assert.ok(moment.label.length <= 80)
})

test("deduplicates by start time, keeps the first reason, and sorts", () => {
  const brief = `
## Your 10 minutes
- 08:00 — Later moment
- 02:00 — First reason wins
- 02:00–03:00 — Duplicate reason
`

  assert.deepEqual(extractMoments(brief), [
    { startSeconds: 120, endSeconds: null, label: "First reason wins" },
    { startSeconds: 480, endSeconds: null, label: "Later moment" },
  ])
})

test("supports the backend's Title, Time, Why table variant", () => {
  const brief = `
## “I Only Have 10 Minutes” Watch Guide
| Title | Time | Why this part matters |
| --- | ---: | --- |
| The reveal | 15:20 | Resolves the central question |
`

  assert.deepEqual(extractMoments(brief), [
    { startSeconds: 920, endSeconds: null, label: "Resolves the central question" },
  ])
})

test("falls back to the middle table cell when the reason is empty", () => {
  const brief = `
## 10 minutes watch guide
| Moment | What you get | Why it matters |
| --- | --- | --- |
| 06:00 | A concise mental model | |
`

  assert.deepEqual(extractMoments(brief), [
    { startSeconds: 360, endSeconds: null, label: "A concise mental model" },
  ])
})

test("drops moments that have no explanatory label", () => {
  const brief = `
## 10 minutes
- [01:00](#t=60)
`

  assert.deepEqual(extractMoments(brief), [])
})

test("ignores timecodes inside a diagram when falling back to the whole brief", () => {
  const markdown = [
    "## 9. Diagrams",
    "",
    "```mermaid",
    "timeline",
    "  Opening claim : 01:00",
    "  Counterexample : 02:00",
    "```",
  ].join("\n")

  assert.deepEqual(extractMoments(markdown), [])
})

test("still finds prose moments alongside a diagram", () => {
  const markdown = [
    "## 3. “I Only Have 10 Minutes” Watch Guide",
    "",
    "- 05:00 The part that matters",
    "",
    "## 9. Diagrams",
    "",
    "```mermaid",
    "timeline",
    "  Opening claim : 01:00",
    "```",
  ].join("\n")

  const moments = extractMoments(markdown)
  assert.equal(moments.length, 1)
  assert.equal(moments[0].startSeconds, 300)
})

test("ignores the total watch time line, even written as a clock value", () => {
  const brief = `
## 3. “I Only Have 10 Minutes” Watch Guide
Total: 4:30 of watching.

| Title | Time | Why this part matters |
| --- | ---: | --- |
| Demo | 04:12–07:40 | Makes the method concrete |
`

  assert.deepEqual(extractMoments(brief), [
    { startSeconds: 252, endSeconds: 460, label: "Makes the method concrete" },
  ])
})
