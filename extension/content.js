// Runs on youtube.com. It reports the open video, seeks the native player,
// brackets the distilled watch moments just above YouTube's own progress bar,
// and drains the color out of the page when grayscale focus is on.
//
// Content scripts are classic scripts, so this file has no static imports.
// grayscale.js is the one exception, reached through a dynamic import: its
// geometry needs to be unit-testable, which a classic script cannot offer.
// Moment extraction stays in the panel; only finished plain data is accepted
// here.

const VIDEO_PATH_PATTERN = /^\/(?:shorts|live|embed)\/([A-Za-z0-9_-]{11})/
const PROGRESS_CONTAINER_SELECTOR = ".ytp-progress-bar-container"
const PROGRESS_BAR_SELECTOR = ".ytp-progress-bar"
const STYLE_ID = "ytd-distilled-marker-styles"
const OVERLAY_CLASS = "ytd-distilled-marker-overlay"
const OVERLAY_HIDDEN_CLASS = "ytd-distilled-marker-overlay-hidden"
// YouTube's own chrome fade. Matching it keeps the brackets tied to the seek bar
// instead of appearing to float over the video on their own.
const CHROME_FADE = "0.25s cubic-bezier(0, 0, 0.2, 1)"
const STRIP_CLASS = "ytd-distilled-grayscale-strip"
// Must match the name panel.js connects with.
const GRAYSCALE_PORT = "grayscale-focus"
const PLAYER_SELECTOR = ".html5-video-player"
const MARKER_CLASS = "ytd-distilled-marker"
const TICK_CLASS = "ytd-distilled-marker-tick"
const RANGE_CLASS = "ytd-distilled-marker-range"
const SHAPE_CLASS = "ytd-distilled-marker-shape"
const LABEL_CLASS = "ytd-distilled-marker-label"
const MARKER_HEIGHT = 9
// A two-pixel upright is too thin to hover, so a single timecode gets a wider
// hit area. It sits above the bar, so the extra width costs no seek precision.
const TICK_HIT_WIDTH = 12

const momentsByVideoId = new Map()
let activeVideoId = null
let overlay = null
let overlayHost = null
let observedChrome = null
let observedContainer = null
let observedBar = null
let observedPlayer = null
let observedVideo = null
let renderedMoments = null
let renderedDuration = null
let syncFrame = null
let grayscaleOn = false
let grayscale = null
let stripElements = null
let stripFrame = null
// The panel ports that currently want this page grayed. A set rather than a
// boolean because one panel can be open per browser window.
const grayscaleRequests = new Set()

const resizeObserver = new ResizeObserver(() => updateOverlayGeometry())
const mutationObserver = new MutationObserver(() => {
  scheduleSync()
  // Theater mode, a collapsed sidebar, and the miniplayer all resize the player
  // through the DOM rather than the window, so the strips ride along here.
  scheduleStripUpdate()
})
const chromeObserver = new MutationObserver(() => syncChromeVisibility())

function readVideoId() {
  const url = new URL(window.location.href)
  const queryId = url.searchParams.get("v")
  if (queryId) return queryId

  const pathMatch = VIDEO_PATH_PATTERN.exec(url.pathname)
  return pathMatch ? pathMatch[1] : null
}

function readText(selectors) {
  for (const selector of selectors) {
    const element = document.querySelector(selector)
    const value = element instanceof HTMLMetaElement || element instanceof HTMLLinkElement
      ? element.getAttribute("content")
      : element?.textContent
    const trimmed = value?.trim()
    if (trimmed) return trimmed
  }
  return null
}

function findVideoElement() {
  return document.querySelector("video.html5-main-video") ?? document.querySelector("video")
}

function probe() {
  const videoId = readVideoId()
  if (!videoId) return { videoId: null }

  const duration = findVideoElement()?.duration
  return {
    videoId,
    title: readText([
      "#above-the-fold #title h1",
      "h1.ytd-watch-metadata",
      'meta[name="title"]',
      'meta[property="og:title"]',
    ]),
    documentTitle: document.title,
    channel: readText([
      "ytd-video-owner-renderer #channel-name a",
      "#owner #channel-name a",
      'link[itemprop="name"]',
    ]),
    duration: Number.isFinite(duration) ? duration : null,
  }
}

function seek(seconds) {
  const video = findVideoElement()
  if (!video) return { ok: false }

  video.currentTime = seconds
  const playback = video.play()
  if (playback && typeof playback.catch === "function") playback.catch(() => undefined)
  video.scrollIntoView({ behavior: "smooth", block: "center" })
  return { ok: true }
}

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return

  const style = document.createElement("style")
  style.id = STYLE_ID
  style.textContent = `
    /* Grayscale focus. Each strip filters what is painted behind it, so the four
       of them together desaturate the viewport except for the player's rect.
       pointer-events stays off so the page underneath is still fully clickable,
       and the z-index sits near the top of the stacking order deliberately: a
       YouTube menu opening above the strips would float in color over a gray
       page. Positions come from grayscaleStrips(). */
    .${STRIP_CLASS} {
      all: initial;
      position: fixed;
      z-index: 2147483646;
      display: block;
      backdrop-filter: grayscale(1);
      -webkit-backdrop-filter: grayscale(1);
      pointer-events: none;
    }

    .${OVERLAY_CLASS} {
      all: initial;
      position: absolute;
      z-index: 60;
      display: block;
      overflow: visible;
      opacity: 1;
      pointer-events: none;
      transition: opacity ${CHROME_FADE};
    }

    /* The seek bar has gone; the brackets go with it. */
    .${OVERLAY_HIDDEN_CLASS} {
      opacity: 0;
    }

    .${OVERLAY_HIDDEN_CLASS} .${MARKER_CLASS} {
      pointer-events: none;
    }

    @media (prefers-reduced-motion: reduce) {
      .${OVERLAY_CLASS} {
        transition: none;
      }
    }

    /* A moment is drawn as a bracket sitting just above the seek bar rather than
       on top of it: an upright at each boundary joined by a rule across the top.
       Nothing overlaps the red played bar or the scrubber, so YouTube's own
       chrome stays readable and clicks on the bar are never intercepted. */
    .${MARKER_CLASS} {
      all: unset;
      box-sizing: border-box;
      position: absolute;
      bottom: calc(100% + 2px);
      z-index: 1;
      display: block;
      height: ${MARKER_HEIGHT}px;
      cursor: pointer;
      pointer-events: auto;
    }

    .${SHAPE_CLASS} {
      all: initial;
      box-sizing: border-box;
      position: absolute;
      bottom: 0;
      display: block;
      height: 100%;
      /* Black lines stay legible over dark footage thanks to a hairline glow,
         which keeps the mark itself black rather than outlining it in white. */
      filter: drop-shadow(0 0 1px rgb(255 255 255 / 0.9));
      pointer-events: none;
    }

    /* Range: uprights at both ends, joined across the top. */
    .${RANGE_CLASS} .${SHAPE_CLASS} {
      left: 0;
      width: 100%;
      border-top: 2px solid #000;
      border-right: 2px solid #000;
      border-left: 2px solid #000;
    }

    /* Single timecode: one upright, centred in a wider hit area. */
    .${TICK_CLASS} {
      width: ${TICK_HIT_WIDTH}px;
    }

    .${TICK_CLASS} .${SHAPE_CLASS} {
      left: 50%;
      width: 2px;
      margin-left: -1px;
      background: #000;
    }

    .${MARKER_CLASS}:hover,
    .${MARKER_CLASS}:focus-visible {
      z-index: 3;
    }

    .${MARKER_CLASS}:hover .${SHAPE_CLASS},
    .${MARKER_CLASS}:focus-visible .${SHAPE_CLASS} {
      height: calc(100% + 3px);
    }

    .${MARKER_CLASS}:focus-visible .${SHAPE_CLASS} {
      filter: drop-shadow(0 0 2px #fff);
    }

    .${LABEL_CLASS} {
      all: initial;
      box-sizing: border-box;
      position: absolute;
      bottom: calc(100% + 8px);
      left: 0;
      display: block;
      width: max-content;
      max-width: 240px;
      border-radius: 3px;
      background: #000;
      padding: 5px 7px;
      color: #fff;
      font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
      font-size: 10px;
      font-weight: 400;
      line-height: 1.35;
      white-space: normal;
      opacity: 0;
      visibility: hidden;
      pointer-events: none;
      transition: opacity 90ms ease-out;
    }

    .${MARKER_CLASS}:hover .${LABEL_CLASS},
    .${MARKER_CLASS}:focus-visible .${LABEL_CLASS} {
      opacity: 1;
      visibility: visible;
    }
  `
  const styleParent = document.head ?? document.documentElement
  styleParent.append(style)
}

/* Grayscale focus --------------------------------------------------------- */

// The player's own chrome stays in color along with the picture, so the hole is
// the player's box rather than the video's. Falling back to the video element
// covers the players YouTube builds without that wrapper class.
function findPlayerBox() {
  const video = findVideoElement()
  return video?.closest(PLAYER_SELECTOR) ?? video
}

// Hosted on documentElement rather than body: YouTube replaces body content
// freely during SPA navigation, and the strips should outlive that.
function ensureStrips() {
  if (stripElements?.every((strip) => strip.isConnected)) return stripElements

  for (const existing of document.querySelectorAll(`.${STRIP_CLASS}`)) existing.remove()
  stripElements = Array.from({ length: 4 }, () => {
    const strip = document.createElement("div")
    strip.className = STRIP_CLASS
    document.documentElement.append(strip)
    return strip
  })
  return stripElements
}

function removeStrips() {
  for (const existing of document.querySelectorAll(`.${STRIP_CLASS}`)) existing.remove()
  stripElements = null
}

function updateStrips() {
  if (!grayscaleOn || !grayscale) return

  ensureStyles()
  const box = findPlayerBox()
  // A page with no player reports a zero rect, which grayscaleStrips() turns
  // into full coverage. That is the intended result on a homepage or a search
  // page: there is no video to spare.
  const player = box
    ? box.getBoundingClientRect()
    : { left: 0, top: 0, width: 0, height: 0 }
  const viewport = { width: window.innerWidth, height: window.innerHeight }

  const strips = ensureStrips()
  grayscale.grayscaleStrips(player, viewport).forEach((rect, index) => {
    const strip = strips[index]
    strip.style.left = `${rect.left}px`
    strip.style.top = `${rect.top}px`
    strip.style.width = `${rect.width}px`
    strip.style.height = `${rect.height}px`
  })
}

function scheduleStripUpdate() {
  if (!grayscaleOn || stripFrame !== null) return
  stripFrame = window.requestAnimationFrame(() => {
    stripFrame = null
    updateStrips()
  })
}

// Grayscale is on while at least one panel still asks for it, which is what
// makes a closed panel undo it: the port dies with the panel's document, its
// request goes with it, and the last one out restores the page's color.
function syncGrayscaleRequests() {
  setGrayscale(grayscaleRequests.size > 0)
}

function setGrayscale(on) {
  if (on === grayscaleOn) return
  grayscaleOn = on

  if (!on) {
    if (stripFrame !== null) window.cancelAnimationFrame(stripFrame)
    stripFrame = null
    removeStrips()
    return
  }
  updateStrips()
}

function formatTimecode(seconds) {
  const whole = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(whole / 3600)
  const minutes = Math.floor((whole % 3600) / 60)
  const remainder = String(whole % 60).padStart(2, "0")
  if (hours) return `${hours}:${String(minutes).padStart(2, "0")}:${remainder}`
  return `${String(minutes).padStart(2, "0")}:${remainder}`
}

function describeMoment(moment) {
  const timecode = moment.endSeconds === null
    ? formatTimecode(moment.startSeconds)
    : `${formatTimecode(moment.startSeconds)}–${formatTimecode(moment.endSeconds)}`
  return { timecode, ariaLabel: `${timecode}: ${moment.label}` }
}

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum)
}

function positionLabel(marker, label) {
  const player = observedPlayer ?? marker.closest(".html5-video-player")
  if (!player) return

  const playerRect = player.getBoundingClientRect()
  const markerRect = marker.getBoundingClientRect()
  label.style.maxWidth = `${Math.max(0, playerRect.width - 8)}px`
  const labelWidth = label.getBoundingClientRect().width
  const idealLeft = markerRect.left + markerRect.width / 2 - labelWidth / 2
  const left = clamp(idealLeft, playerRect.left + 4, playerRect.right - labelWidth - 4)
  label.style.left = `${left - markerRect.left}px`
}

function activateMarker(event, seconds) {
  event.preventDefault()
  event.stopPropagation()
  seek(seconds)
}

function createMarker(moment) {
  const marker = document.createElement("button")
  marker.type = "button"
  marker.className = MARKER_CLASS
  marker.dataset.startSeconds = String(moment.startSeconds)
  if (moment.endSeconds !== null) marker.dataset.endSeconds = String(moment.endSeconds)

  const description = describeMoment(moment)
  marker.setAttribute("aria-label", description.ariaLabel)

  // The bracket is a child rather than the button's own border so the hit area
  // can be wider than the drawn lines.
  const shape = document.createElement("span")
  shape.className = SHAPE_CLASS

  const label = document.createElement("span")
  label.className = LABEL_CLASS
  label.textContent = moment.label
  marker.append(shape, label)

  marker.addEventListener("click", (event) => activateMarker(event, moment.startSeconds))
  marker.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") activateMarker(event, moment.startSeconds)
  })
  marker.addEventListener("mouseenter", () => positionLabel(marker, label))
  marker.addEventListener("focus", () => positionLabel(marker, label))
  return marker
}

function positionMarkers() {
  if (!overlay || !observedVideo) return

  const duration = observedVideo.duration
  const validDuration = Number.isFinite(duration) && duration > 0
  for (const marker of overlay.querySelectorAll(`.${MARKER_CLASS}`)) {
    marker.hidden = !validDuration
    if (!validDuration) continue

    const startSeconds = Number(marker.dataset.startSeconds)
    const endSeconds = marker.dataset.endSeconds === undefined ? null : Number(marker.dataset.endSeconds)
    const startPercent = clamp((startSeconds / duration) * 100, 0, 100)
    const endPercent = endSeconds === null ? null : clamp((endSeconds / duration) * 100, 0, 100)
    const isRange = endPercent !== null && endPercent > startPercent

    marker.classList.toggle(RANGE_CLASS, isRange)
    marker.classList.toggle(TICK_CLASS, !isRange)
    if (isRange) {
      marker.style.left = `${startPercent}%`
      marker.style.width = `${endPercent - startPercent}%`
      marker.style.transform = "none"
    } else {
      // The hit area is centred on the timecode, then clamped so a moment at
      // either extreme still sits fully inside the bar.
      const half = TICK_HIT_WIDTH / 2
      marker.style.left =
        `clamp(0px, calc(${startPercent}% - ${half}px), calc(100% - ${TICK_HIT_WIDTH}px))`
      marker.style.removeProperty("width")
      marker.style.transform = "none"
    }
  }
  renderedDuration = duration
}

function renderMarkers(moments) {
  if (!overlay) return
  overlay.replaceChildren(...moments.map(createMarker))
  renderedMoments = moments
  renderedDuration = null
  positionMarkers()
}

function updateOverlayGeometry() {
  if (!overlay || !overlayHost || !observedContainer || !observedBar) return
  if (
    !overlay.isConnected
    || !overlayHost.isConnected
    || !observedContainer.isConnected
    || !observedBar.isConnected
  ) {
    scheduleSync()
    return
  }

  // The overlay tracks the bar's box but is positioned within its host, so the
  // offsets are measured between the two rects and divided back out of any
  // transform the player applies.
  const hostRect = overlayHost.getBoundingClientRect()
  const barRect = observedBar.getBoundingClientRect()
  const scaleX = overlayHost.offsetWidth ? hostRect.width / overlayHost.offsetWidth : 1
  const scaleY = overlayHost.offsetHeight ? hostRect.height / overlayHost.offsetHeight : 1
  overlay.style.left = `${(barRect.left - hostRect.left) / (scaleX || 1)}px`
  overlay.style.top = `${(barRect.top - hostRect.top) / (scaleY || 1)}px`
  overlay.style.width = `${barRect.width / (scaleX || 1)}px`
  overlay.style.height = `${barRect.height / (scaleY || 1)}px`

  if (observedVideo.duration !== renderedDuration) positionMarkers()
  for (const marker of overlay.querySelectorAll(`.${MARKER_CLASS}:hover, .${MARKER_CLASS}:focus-visible`)) {
    const label = marker.querySelector(`.${LABEL_CLASS}`)
    if (label) positionLabel(marker, label)
  }
}

function onDurationChange() {
  positionMarkers()
}

// The player carries ytp-autohide while its controls are hidden, which is the
// same signal YouTube fades its own chrome on. The computed check behind it
// covers the cases that hide the bar without touching that class.
function isSeekBarVisible() {
  if (!observedPlayer) return true
  if (observedPlayer.classList.contains("ytp-autohide")) return false
  if (observedPlayer.classList.contains("ytp-hide-controls")) return false

  const chrome_ = observedChrome ?? observedContainer
  if (!chrome_) return true

  // Only non-animated properties are safe to read here. Opacity is the one
  // YouTube transitions, and it is still 0 at the instant the autohide class is
  // removed — reading it would report "hidden" during the fade back in and leave
  // the overlay stuck that way, because nothing else would mutate to re-check.
  const style = getComputedStyle(chrome_)
  return style.display !== "none" && style.visibility !== "hidden"
}

function syncChromeVisibility() {
  overlay?.classList.toggle(OVERLAY_HIDDEN_CLASS, !isSeekBarVisible())
}

function disconnectPlayer() {
  resizeObserver.disconnect()
  chromeObserver.disconnect()
  if (observedVideo) {
    observedVideo.removeEventListener("loadedmetadata", onDurationChange)
    observedVideo.removeEventListener("durationchange", onDurationChange)
  }
  overlay?.remove()
  overlay = null
  overlayHost = null
  observedChrome = null
  observedContainer = null
  observedBar = null
  observedPlayer = null
  observedVideo = null
  renderedMoments = null
  renderedDuration = null
}

function attachPlayer(container, bar, video) {
  disconnectPlayer()

  const player = container.closest(".html5-video-player")
  // The brackets are drawn above the seek bar, so they would be cut off if the
  // progress container ever clipped its overflow. Hosting them on the player
  // itself removes that dependency; the container is only a fallback for when
  // the player is missing or is not a positioned ancestor.
  const host = player && getComputedStyle(player).position !== "static" ? player : container
  for (const existing of document.querySelectorAll(`.${OVERLAY_CLASS}`)) existing.remove()

  overlay = document.createElement("div")
  overlay.className = OVERLAY_CLASS
  host.append(overlay)

  overlayHost = host
  observedChrome = container.closest(".ytp-chrome-bottom")
  observedContainer = container
  observedBar = bar
  observedPlayer = player
  observedVideo = video
  video.addEventListener("loadedmetadata", onDurationChange)
  video.addEventListener("durationchange", onDurationChange)

  resizeObserver.observe(container)
  resizeObserver.observe(bar)
  if (observedPlayer) resizeObserver.observe(observedPlayer)

  if (observedPlayer) {
    chromeObserver.observe(observedPlayer, { attributes: true, attributeFilter: ["class"] })
  }
  if (observedChrome) {
    chromeObserver.observe(observedChrome, { attributes: true, attributeFilter: ["class", "style"] })
  }
  syncChromeVisibility()
}

function syncPlayer() {
  ensureStyles()

  const nextVideoId = readVideoId()
  if (nextVideoId !== activeVideoId) {
    activeVideoId = nextVideoId
    disconnectPlayer()
  }

  const moments = activeVideoId ? momentsByVideoId.get(activeVideoId) : null
  if (!moments?.length) {
    disconnectPlayer()
    return
  }

  const container = document.querySelector(PROGRESS_CONTAINER_SELECTOR)
  const bar = container?.querySelector(PROGRESS_BAR_SELECTOR)
  const video = findVideoElement()
  if (!container || !bar || !video) {
    disconnectPlayer()
    return
  }

  if (
    container !== observedContainer
    || bar !== observedBar
    || video !== observedVideo
    || !overlay?.isConnected
  ) {
    attachPlayer(container, bar, video)
  }

  if (moments !== renderedMoments) renderMarkers(moments)
  updateOverlayGeometry()
}

function scheduleSync() {
  if (syncFrame !== null) return
  syncFrame = window.requestAnimationFrame(() => {
    syncFrame = null
    syncPlayer()
  })
}

function normalizeMoments(candidate) {
  if (!Array.isArray(candidate)) return []
  return candidate.flatMap((moment) => {
    const startSeconds = Number(moment?.startSeconds)
    const endSeconds = moment?.endSeconds === null ? null : Number(moment?.endSeconds)
    const label = typeof moment?.label === "string" ? moment.label.trim() : ""
    if (!Number.isFinite(startSeconds) || startSeconds < 0 || !label) return []
    return [{
      startSeconds,
      endSeconds: endSeconds !== null && Number.isFinite(endSeconds) ? endSeconds : null,
      label,
    }]
  })
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "probe") {
    sendResponse(probe())
    return false
  }
  if (message?.type === "seek") {
    sendResponse(seek(message.seconds))
    return false
  }
  if (message?.type === "set-moments" && typeof message.videoId === "string") {
    const moments = normalizeMoments(message.moments)
    momentsByVideoId.set(message.videoId, moments)
    scheduleSync()
    sendResponse({ ok: true, moments: moments.length })
    return false
  }
  if (message?.type === "clear-moments" && typeof message.videoId === "string") {
    momentsByVideoId.delete(message.videoId)
    if (message.videoId === activeVideoId) disconnectPlayer()
    sendResponse({ ok: true })
    return false
  }
  return false
})

// Grayscale focus lasts exactly as long as the panel that asked for it. The
// panel opens a port per tab and posts the toggle down it; nothing is stored, so
// closing the panel — or crashing it — takes the color drain along, and a panel
// reopening finds the page in color again.
//
// The port is registered here rather than after the dynamic import so a panel
// connecting during that round trip is never missed.
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== GRAYSCALE_PORT) return

  port.onMessage.addListener((message) => {
    if (message?.on === true) grayscaleRequests.add(port)
    else grayscaleRequests.delete(port)
    syncGrayscaleRequests()
  })
  port.onDisconnect.addListener(() => {
    grayscaleRequests.delete(port)
    syncGrayscaleRequests()
  })
})

window.addEventListener("yt-navigate-finish", () => {
  scheduleSync()
  scheduleStripUpdate()
  chrome.runtime.sendMessage({ type: "video-changed" }).catch(() => undefined)
})

// Scrolling moves the player without resizing anything, so it needs its own
// trigger. Both are passive: the handler only ever queues a frame.
window.addEventListener("scroll", scheduleStripUpdate, { passive: true })
window.addEventListener("resize", scheduleStripUpdate, { passive: true })

// The geometry comes from grayscale.js, which a classic content script can only
// reach through a dynamic import. It costs a round trip at startup that nothing
// waits on: a page asked to gray before the module lands stays in color for
// another frame or two, and the import finishes the job on arrival.
async function startGrayscale() {
  grayscale = await import(chrome.runtime.getURL("grayscale.js"))
  updateStrips()
}

function stopWatching() {
  if (syncFrame !== null) window.cancelAnimationFrame(syncFrame)
  syncFrame = null
  if (stripFrame !== null) window.cancelAnimationFrame(stripFrame)
  stripFrame = null
  mutationObserver.disconnect()
  disconnectPlayer()
}

function startWatching() {
  mutationObserver.observe(document.documentElement, { childList: true, subtree: true })
  scheduleSync()
  scheduleStripUpdate()
}

window.addEventListener("pagehide", stopWatching)
window.addEventListener("pageshow", startWatching)

ensureStyles()
startWatching()
startGrayscale().catch(() => undefined)

// An open panel cannot know about a tab that did not exist when it last looked,
// and this script is the first thing in the tab that does. The same message the
// panel already refreshes on brings it here to connect its grayscale port, so a
// tab opened while focus is on catches up instead of staying in color.
chrome.runtime.sendMessage({ type: "video-changed" }).catch(() => undefined)
