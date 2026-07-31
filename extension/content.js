// Runs on youtube.com. It reports the open video, seeks the native player, and
// renders distilled watch moments over YouTube's own progress bar.
//
// Content scripts are classic scripts, so this file deliberately imports
// nothing. Moment extraction stays in the panel; only finished plain data is
// accepted here.

const VIDEO_PATH_PATTERN = /^\/(?:shorts|live|embed)\/([A-Za-z0-9_-]{11})/
const PROGRESS_CONTAINER_SELECTOR = ".ytp-progress-bar-container"
const PROGRESS_BAR_SELECTOR = ".ytp-progress-bar"
const STYLE_ID = "ytd-distilled-marker-styles"
const OVERLAY_CLASS = "ytd-distilled-marker-overlay"
const MARKER_CLASS = "ytd-distilled-marker"
const TICK_CLASS = "ytd-distilled-marker-tick"
const RANGE_CLASS = "ytd-distilled-marker-range"
const LABEL_CLASS = "ytd-distilled-marker-label"

const momentsByVideoId = new Map()
let activeVideoId = null
let overlay = null
let observedContainer = null
let observedBar = null
let observedPlayer = null
let observedVideo = null
let renderedMoments = null
let renderedDuration = null
let syncFrame = null

const resizeObserver = new ResizeObserver(() => updateOverlayGeometry())
const mutationObserver = new MutationObserver(() => scheduleSync())

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
    .${OVERLAY_CLASS} {
      all: initial;
      position: absolute;
      z-index: 60;
      display: block;
      overflow: visible;
      pointer-events: none;
    }

    /* The bar is only a few pixels tall, so a marker sized to it reads as an
       outline rather than a black mark. Overhanging it vertically gives the
       fill enough mass to stay unmistakably black against red and grey alike,
       while the hairline ring keeps an edge over bright thumbnails. */
    .${MARKER_CLASS} {
      all: unset;
      box-sizing: border-box;
      position: absolute;
      bottom: -3px;
      z-index: 1;
      display: block;
      height: calc(100% + 6px);
      min-height: 11px;
      border-radius: 1px;
      background: #000;
      box-shadow: 0 0 0 1px rgb(255 255 255 / 0.55), 0 0 3px rgb(0 0 0 / 0.75);
      cursor: pointer;
      pointer-events: auto;
    }

    .${TICK_CLASS} {
      width: 4px;
      min-width: 4px;
    }

    .${MARKER_CLASS}:hover,
    .${MARKER_CLASS}:focus-visible {
      z-index: 3;
      bottom: -5px;
      height: calc(100% + 10px);
      box-shadow: 0 0 0 1px #fff, 0 0 4px rgb(0 0 0 / 0.8);
    }

    .${MARKER_CLASS}:focus-visible {
      outline: 2px solid #fff;
      outline-offset: 2px;
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

  const label = document.createElement("span")
  label.className = LABEL_CLASS
  label.textContent = moment.label
  marker.append(label)

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
      marker.style.left = `clamp(0px, calc(${startPercent}% - 2px), calc(100% - 4px))`
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
  if (!overlay || !observedContainer || !observedBar) return
  if (!overlay.isConnected || !observedContainer.isConnected || !observedBar.isConnected) {
    scheduleSync()
    return
  }

  const containerRect = observedContainer.getBoundingClientRect()
  const barRect = observedBar.getBoundingClientRect()
  const scaleX = observedContainer.offsetWidth ? containerRect.width / observedContainer.offsetWidth : 1
  const scaleY = observedContainer.offsetHeight ? containerRect.height / observedContainer.offsetHeight : 1
  overlay.style.left = `${(barRect.left - containerRect.left) / (scaleX || 1)}px`
  overlay.style.top = `${(barRect.top - containerRect.top) / (scaleY || 1)}px`
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

function disconnectPlayer() {
  resizeObserver.disconnect()
  if (observedVideo) {
    observedVideo.removeEventListener("loadedmetadata", onDurationChange)
    observedVideo.removeEventListener("durationchange", onDurationChange)
  }
  overlay?.remove()
  overlay = null
  observedContainer = null
  observedBar = null
  observedPlayer = null
  observedVideo = null
  renderedMoments = null
  renderedDuration = null
}

function attachPlayer(container, bar, video) {
  disconnectPlayer()
  for (const existing of container.querySelectorAll(`:scope > .${OVERLAY_CLASS}`)) existing.remove()

  overlay = document.createElement("div")
  overlay.className = OVERLAY_CLASS
  container.append(overlay)

  observedContainer = container
  observedBar = bar
  observedPlayer = container.closest(".html5-video-player")
  observedVideo = video
  video.addEventListener("loadedmetadata", onDurationChange)
  video.addEventListener("durationchange", onDurationChange)

  resizeObserver.observe(container)
  resizeObserver.observe(bar)
  if (observedPlayer) resizeObserver.observe(observedPlayer)
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

window.addEventListener("yt-navigate-finish", () => {
  scheduleSync()
  chrome.runtime.sendMessage({ type: "video-changed" }).catch(() => undefined)
})

function stopWatching() {
  if (syncFrame !== null) window.cancelAnimationFrame(syncFrame)
  syncFrame = null
  mutationObserver.disconnect()
  disconnectPlayer()
}

function startWatching() {
  mutationObserver.observe(document.documentElement, { childList: true, subtree: true })
  scheduleSync()
}

window.addEventListener("pagehide", stopWatching)
window.addEventListener("pageshow", startWatching)

ensureStyles()
startWatching()
