import assert from "node:assert/strict"
import test from "node:test"

import { nearestPlayerCorner } from "../src/player-position.ts"

const player = { width: 400, height: 260 }
const viewport = { width: 1200, height: 800 }

test("snaps the floating player to each viewport corner", () => {
  assert.equal(nearestPlayerCorner({ left: 20, top: 20 }, player, viewport), "top-left")
  assert.equal(nearestPlayerCorner({ left: 780, top: 20 }, player, viewport), "top-right")
  assert.equal(nearestPlayerCorner({ left: 20, top: 520 }, player, viewport), "bottom-left")
  assert.equal(nearestPlayerCorner({ left: 780, top: 520 }, player, viewport), "bottom-right")
})

test("uses the player center when choosing the nearest corner", () => {
  assert.equal(nearestPlayerCorner({ left: 399, top: 269 }, player, viewport), "top-left")
  assert.equal(nearestPlayerCorner({ left: 401, top: 271 }, player, viewport), "bottom-right")
})
