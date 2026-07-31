// Runs on youtube.com. Answers two questions from the side panel — which video
// is open, and please jump to this second — and tells the panel when YouTube
// navigates to a different video without a page load.
//
// Content scripts are classic scripts, so this file imports nothing. It reports
// the raw document title alongside the cleaner DOM title and lets the panel
// decide which to use.

const VIDEO_PATH_PATTERN = /^\/(?:shorts|live|embed)\/([A-Za-z0-9_-]{11})/

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

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "probe") {
    sendResponse(probe())
    return false
  }
  if (message?.type === "seek") {
    sendResponse(seek(message.seconds))
    return false
  }
  return false
})

window.addEventListener("yt-navigate-finish", () => {
  chrome.runtime.sendMessage({ type: "video-changed" }).catch(() => undefined)
})
