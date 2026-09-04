import assert from "node:assert/strict"
import test from "node:test"

import { extractVerdict, isVerdictHeading, verdictBand } from "../extension/verdict.js"

test("reads the score and reason the brief opens with", () => {
  const brief = `
## 0. Verdict
Score: 82/100
Why: It goes deep on the retrieval design you are building right now.

## 1. Video Summary
The rest of the brief.
`

  assert.deepEqual(extractVerdict(brief), {
    score: 82,
    reason: "It goes deep on the retrieval design you are building right now.",
    floor: 70,
    tone: "watch",
    label: "Watch",
    note: "Worth your time in full",
  })
})

test("survives the emphasis a model puts on labels it was told to write plainly", () => {
  const bolded = extractVerdict("## Verdict\n**Score:** 55/100\n**Why:** Half of it is filler.")
  const wrapped = extractVerdict("## Verdict\n**Score: 55/100**\n**Why: Half of it is filler.**")
  const bulleted = extractVerdict("## Verdict\n- Score — 55/100\n- Why — Half of it is filler.")

  for (const verdict of [bolded, wrapped, bulleted]) {
    assert.equal(verdict?.score, 55)
    assert.equal(verdict?.reason, "Half of it is filler.")
  }
})

test("joins a reason that runs over several lines", () => {
  const verdict = extractVerdict(`
## 0. Verdict
Score: 30/100
Why: Introductory framing you are years past,
and the one new idea is stated without evidence.

## 1. Video Summary
`)

  assert.equal(
    verdict?.reason,
    "Introductory framing you are years past, and the one new idea is stated without evidence.",
  )
})

test("maps each score to the action it should land on", () => {
  assert.equal(verdictBand(100).tone, "watch")
  assert.equal(verdictBand(70).tone, "watch")
  assert.equal(verdictBand(69).tone, "skim")
  assert.equal(verdictBand(40).tone, "skim")
  assert.equal(verdictBand(39).tone, "skip")
  assert.equal(verdictBand(0).tone, "skip")
})

test("stops at the next section so a later score cannot leak in", () => {
  const verdict = extractVerdict(`
## 0. Verdict
Score: 45/100
Why: One good passage, a lot of padding.

## 1. Video Summary
Score: 99/100 is quoted from the video's own benchmark table.
`)

  assert.equal(verdict?.score, 45)
  assert.equal(verdict?.reason, "One good passage, a lot of padding.")
})

test("ignores a fenced block that looks like the verdict section", () => {
  const verdict = extractVerdict(`
## 0. Verdict
Score: 45/100
Why: One good passage.

## 9. Diagrams
\`\`\`markdown
## Verdict
Score: 5/100
\`\`\`
`)

  assert.equal(verdict?.score, 45)
})

test("returns nothing when there is no usable number", () => {
  assert.equal(extractVerdict("## 1. Video Summary\nNo verdict was written."), null)
  assert.equal(extractVerdict("## 0. Verdict\nWhy: The model forgot the score."), null)
  assert.equal(extractVerdict("## 0. Verdict\nScore: 420/100\nWhy: Out of range."), null)
})

test("recognizes the heading whether or not the model numbers it", () => {
  assert.equal(isVerdictHeading("0. Verdict"), true)
  assert.equal(isVerdictHeading("Verdict"), true)
  assert.equal(isVerdictHeading("Verdict and score"), true)
  assert.equal(isVerdictHeading("Video Summary"), false)
})
