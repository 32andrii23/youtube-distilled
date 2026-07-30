export type PlayerCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right"

type Point = {
  left: number
  top: number
}

type Size = {
  width: number
  height: number
}

export function nearestPlayerCorner(
  position: Point,
  playerSize: Size,
  viewportSize: Size,
): PlayerCorner {
  const horizontal = position.left + playerSize.width / 2 < viewportSize.width / 2 ? "left" : "right"
  const vertical = position.top + playerSize.height / 2 < viewportSize.height / 2 ? "top" : "bottom"
  return `${vertical}-${horizontal}`
}
