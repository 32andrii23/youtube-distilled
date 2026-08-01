import assert from "node:assert/strict"
import test from "node:test"

import { grayscaleStrips } from "../extension/grayscale.js"

const VIEWPORT = { width: 1000, height: 800 }

type Rect = { left: number; top: number; width: number; height: number }

function area({ width, height }: Rect) {
  return Math.max(0, width) * Math.max(0, height)
}

function overlap(a: Rect, b: Rect) {
  const width = Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left)
  const height = Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top)
  return Math.max(0, width) * Math.max(0, height)
}

// The strips are only correct if they tile the viewport minus the hole exactly:
// no gap leaks color through, no overlap stacks two backdrop filters. Checking
// the areas catches both at once, so every case below runs through it.
function assertTiles(player: Rect, viewport = VIEWPORT) {
  const strips = grayscaleStrips(player, viewport)

  const visibleWidth =
    Math.min(player.left + player.width, viewport.width) - Math.max(player.left, 0)
  const visibleHeight =
    Math.min(player.top + player.height, viewport.height) - Math.max(player.top, 0)
  const hole = Math.max(0, visibleWidth) * Math.max(0, visibleHeight)

  const covered = strips.reduce((total, strip) => total + area(strip), 0)
  assert.equal(covered, viewport.width * viewport.height - hole)

  for (const [index, strip] of strips.entries()) {
    assert.ok(strip.width >= 0, `strip ${index} has negative width`)
    assert.ok(strip.height >= 0, `strip ${index} has negative height`)
    for (const other of strips.slice(index + 1)) {
      assert.equal(overlap(strip, other), 0)
    }
  }

  return strips
}

test("a centred player is surrounded on all four sides", () => {
  const strips = assertTiles({ left: 200, top: 100, width: 600, height: 400 })

  assert.deepEqual(strips, [
    { left: 0, top: 0, width: 1000, height: 100 },
    { left: 0, top: 500, width: 1000, height: 300 },
    { left: 0, top: 100, width: 200, height: 400 },
    { left: 800, top: 100, width: 200, height: 400 },
  ])
})

test("a player filling the viewport leaves nothing to gray", () => {
  const strips = assertTiles({ left: 0, top: 0, width: 1000, height: 800 })

  for (const strip of strips) assert.equal(area(strip), 0)
})

// Fullscreen hands back a rect slightly larger than the viewport on some
// zoom levels, and a negative strip would be painted as a positive one.
test("a player larger than the viewport still leaves nothing to gray", () => {
  const strips = assertTiles({ left: -20, top: -20, width: 1080, height: 880 })

  for (const strip of strips) assert.equal(area(strip), 0)
})

test("a player flush against an edge drops the strip on that side", () => {
  const [above, below, leftOf, rightOf] = assertTiles({
    left: 0,
    top: 0,
    width: 400,
    height: 300,
  })

  assert.equal(area(above), 0)
  assert.equal(area(leftOf), 0)
  assert.deepEqual(below, { left: 0, top: 300, width: 1000, height: 500 })
  assert.deepEqual(rightOf, { left: 400, top: 0, width: 600, height: 300 })
})

test("a player flush against the far edges drops the other two strips", () => {
  const [above, below, leftOf, rightOf] = assertTiles({
    left: 600,
    top: 500,
    width: 400,
    height: 300,
  })

  assert.equal(area(below), 0)
  assert.equal(area(rightOf), 0)
  assert.deepEqual(above, { left: 0, top: 0, width: 1000, height: 500 })
  assert.deepEqual(leftOf, { left: 0, top: 500, width: 600, height: 300 })
})

test("scrolling the player halfway past the top shortens the hole", () => {
  const [above, below, leftOf, rightOf] = assertTiles({
    left: 200,
    top: -200,
    width: 600,
    height: 400,
  })

  assert.equal(area(above), 0)
  assert.deepEqual(below, { left: 0, top: 200, width: 1000, height: 600 })
  assert.deepEqual(leftOf, { left: 0, top: 0, width: 200, height: 200 })
  assert.deepEqual(rightOf, { left: 800, top: 0, width: 200, height: 200 })
})

test("a player scrolled entirely out of view grays the whole viewport", () => {
  const strips = assertTiles({ left: 200, top: -900, width: 600, height: 400 })
  const covered = strips.reduce((total, strip) => total + area(strip), 0)

  assert.equal(covered, VIEWPORT.width * VIEWPORT.height)
})

test("a player below the fold grays the whole viewport", () => {
  const strips = assertTiles({ left: 200, top: 1200, width: 600, height: 400 })
  const covered = strips.reduce((total, strip) => total + area(strip), 0)

  assert.equal(covered, VIEWPORT.width * VIEWPORT.height)
})

// A page with no player at all reports a zero rect, and graying everything is
// the right answer there rather than a reason to bail out.
test("a missing player grays the whole viewport", () => {
  const strips = assertTiles({ left: 0, top: 0, width: 0, height: 0 })
  const covered = strips.reduce((total, strip) => total + area(strip), 0)

  assert.equal(covered, VIEWPORT.width * VIEWPORT.height)
})
