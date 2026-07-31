# Grayscale focus in the extension

A third header button in the side panel drains the color out of the YouTube page
while leaving the video player in color. It is a toggle: on until clicked off,
and it survives a reload and a jump to the next video.

## Why a filter on `<html>` will not do

The obvious implementation — `filter: grayscale(1)` on the document element, then
opt the player back out — cannot work. A CSS filter on an ancestor is baked into
the descendants' rendering, and there is no inverse filter to undo it. Nothing a
descendant declares can restore the color its parent removed.

The exclusion therefore has to happen in front of the page rather than inside it.

## Mechanism

Four `position: fixed` strips — above, below, left, and right of the player's
bounding rect — each carrying `backdrop-filter: grayscale(1)`. Together they
cover the viewport except for the player, so everything behind them desaturates
and the player does not.

The strips are `pointer-events: none`, so the page stays fully interactive, and
they sit above YouTube's own menus so popups gray out with everything else rather
than floating in color over a gray page.

This never names a YouTube element, which is the point. The marker overlay in
`content.js` depends on `.ytp-progress-bar-container` and friends and has to be
resynced whenever they move; the strips depend only on a rectangle. A YouTube
redesign cannot break them.

Two cases fall out for free:

- **Theater and fullscreen.** The player fills the viewport, so all four strips
  compute to zero size. No special casing.
- **Partial scroll-off.** The rect is clamped to the viewport, so a player
  half-scrolled past the top leaves a correspondingly shorter hole.

## Geometry

One pure function owns the math:

| Function | Contract |
| --- | --- |
| `grayscaleStrips(playerRect, viewport)` | Four `{left, top, width, height}` rects covering the viewport minus the clamped player rect |

Keeping it pure is what makes it testable — the DOM side stays dumb enough that
it only assigns the four results to four elements' styles.

It lives in `extension/geometry.js` as an ES module rather than inline in
`content.js`, because `content.js` is a classic script with no exports and so
nothing in it can be reached from a test. `content.js` picks the module up with a
dynamic `import(chrome.runtime.getURL("geometry.js"))` on the first toggle, and
`geometry.js` joins `web_accessible_resources` in the manifest.

That is a deliberate exception to the "this file deliberately imports nothing"
note at the top of `content.js`, and the note is amended to say why. The
alternative — a second copy of the math inside `content.js`, tested through the
module — is the duplication-plus-drift-test pattern used for `theme.js` and
`markdown.js`, but those duplicate across two surfaces that genuinely cannot
share code. Two copies inside one extension have no such excuse.

Loading lazily rather than at startup keeps this off the page-load path. Nothing
needs the geometry until the user clicks the button.

The rect is read through the machinery `content.js` already runs: the existing
`ResizeObserver` and the `scheduleSync` / `requestAnimationFrame` coalescing at
`content.js:493`. Scroll is added as a further trigger for the same scheduler,
since scrolling moves the player rect without resizing anything.

## State

A boolean under its own `chrome.storage.local` key, `youtube-distilled-grayscale`.

Its own key rather than a field on `AppSettings`, for the reason the theme mode
gets its own key: settings are spread into the request body (`{ url, ...settings }`)
and `SummaryRequest` in `backend/main.py` accepts only `url`, `provider`, `model`,
and `reasoning`. A view preference does not belong in an API contract.

The panel loads it at boot next to `SETTINGS_KEY` and pushes it to the active tab
on every `refresh()`, so a reload or an SPA navigation to the next video comes
back gray without the user re-clicking.

## Surfaces

This is the *third* button in a row whose first two have not landed on the
extension yet. `extension/theme.js` exists, but nothing imports it, and
`panel.html` still carries the plain gear. The theme toggle and the provider-mark
trigger come from the in-flight
[dark mode and model picker](2026-07-31-dark-mode-and-model-picker-design.md)
work, and this button assumes they arrive first.

If they have not, the grayscale button is simply the second control in the header
and slides left when they do. Nothing here depends on their internals — only on
the header being a flex row of round icon buttons, which it already is.

**`extension/panel.html`** — a third `icon-button` in the header row, after the
theme toggle and the provider-mark trigger. `aria-pressed` carries the state;
`aria-label` names what a click will do. The icon is a half-filled circle, which
reads as desaturation without a text label.

**`extension/panel.js`** — loads and persists the key, renders the pressed state,
and sends the toggle to the tab.

**`extension/content.js`** — a `set-grayscale` message beside `set-moments`,
the strip elements, and re-assertion on `yt-navigate-finish`. The strips are
created outside the marker overlay, so the moment brackets stay inside the color
hole and keep their black-on-white treatment.

## Scope

Only the youtube.com page desaturates. The side panel keeps its own appearance —
it is already monochrome, so graying it would change almost nothing while
flattening the provider marks and any diagram color.

The player's own chrome stays in color along with the picture, since the hole is
the player's rect. The red progress bar staying red is the intended reading of
"except the video window".

## Testing

`tests/grayscale-strips.test.ts` (node:test, matching
`tests/player-position.test.ts`) imports `extension/geometry.js` and covers
`grayscaleStrips`: a centered player, a
player flush against each viewport edge, a player filling the viewport (all four
strips zero-sized), and a player scrolled partly out of view.

Then the extension loaded in Chrome and driven on a real video to confirm the
toggle, the persistence across reload and next-video, and that the page stays
clickable through the strips.
