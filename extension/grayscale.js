// Grayscale focus: the page loses its color, the video keeps it.
//
// A filter on <html> cannot do this. A CSS filter on an ancestor is baked into
// how its descendants render, and there is no inverse filter, so nothing the
// player declares could restore what the document element took away. The
// exclusion has to happen in front of the page instead: four strips around the
// player, each with a grayscale backdrop filter, covering the viewport except
// for the video.
//
// This lives in its own module because content.js is a classic content script
// with no exports, so nothing defined inside it can be reached from a test.
// content.js pulls this in with a dynamic import.

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum)
}

// Four rects that together cover `viewport` except for whatever part of `player`
// falls inside it, in the order: above, below, left, right.
//
// Both rects are plain `{left, top, width, height}` — the caller passes a
// getBoundingClientRect() and a window size, so this stays free of the DOM.
//
// Clamping the player to the viewport is what makes the awkward cases ordinary.
// A player filling the screen (theater, fullscreen) leaves every strip
// zero-sized, so there is nothing to gray and no special case to write. A player
// scrolled halfway past the top leaves a correspondingly shorter hole. A player
// entirely off-screen, or missing altogether, collapses the hole to nothing and
// the whole viewport goes gray — which is the right reading of "everything
// except the video" on a page with no video on it.
export function grayscaleStrips(player, viewport) {
  const left = clamp(player.left, 0, viewport.width)
  const right = clamp(player.left + player.width, 0, viewport.width)
  const top = clamp(player.top, 0, viewport.height)
  const bottom = clamp(player.top + player.height, 0, viewport.height)

  // The horizontal strips span the full width and the vertical ones fill only
  // the band beside the hole, so no two strips overlap. Stacked backdrop filters
  // would each filter the one beneath, and while grayscale(1) happens to be
  // idempotent, non-overlapping strips keep the compositing cheap and the seams
  // exact.
  return [
    { left: 0, top: 0, width: viewport.width, height: top },
    { left: 0, top: bottom, width: viewport.width, height: viewport.height - bottom },
    { left: 0, top, width: left, height: bottom - top },
    { left: right, top, width: viewport.width - right, height: bottom - top },
  ]
}
