// The side panel. Owns the state machine and all rendering.
//
// Video detection and timecode seeking stay in the content script. This panel
// owns the local API requests, settings, and rendering.

import { formatDuration, formatElapsed, formatStepDuration, cleanVideoTitle } from "./format.js"
import { renderMarkdown, splitSummary } from "./markdown.js"
import { extractMoments } from "./moments.js"
import { DEFAULT_SETTINGS, FALLBACK_PROVIDERS, isSelectableProvider, normalizeSettings as normalizeSettingsFromCatalog } from "./provider-catalog.js"

const API_URL = "http://127.0.0.1:4322"
const SETTINGS_KEY = "youtube-distilled-settings"
const NOTICE_TIMEOUT_MS = 6000

const PROVIDER_LABELS = { codex: "Codex", claude: "Claude" }

const LOADING_STAGES = [
  { at: 0, label: "Opening the video context" },
  { at: 8, label: "Finding transcript and chapters" },
  { at: 35, label: "Analyzing the argument" },
  { at: 90, label: "Selecting the moments worth watching" },
  { at: 180, label: "Compressing the final brief" },
]

const element = (id) => document.getElementById(id)

const ui = {
  states: {
    "no-video": element("state-no-video"),
    idle: element("state-idle"),
    running: element("state-running"),
    success: element("state-success"),
    error: element("state-error"),
    "service-unavailable": element("state-service-unavailable"),
  },
  settingsToggle: element("settings-toggle"),
  settings: element("settings"),
  modelSelect: element("model-select"),
  reasoningSelect: element("reasoning-select"),
  thumbnail: element("video-thumbnail"),
  title: element("video-title"),
  channel: element("video-channel"),
  duration: element("video-duration"),
  idleConfig: element("idle-config"),
  distill: element("distill"),
  loadingStage: element("loading-stage"),
  loadingConfig: element("loading-config"),
  loadingElapsed: element("loading-elapsed"),
  timingsToggle: element("timings-toggle"),
  timingsLabel: element("timings-label"),
  timings: element("timings"),
  copy: element("copy"),
  openVideo: element("open-video"),
  reset: element("reset"),
  markerStatus: element("marker-status"),
  notice: element("result-notice"),
  sections: element("sections"),
  errorMessage: element("error-message"),
  errorReset: element("error-reset"),
  serviceCopy: element("service-copy"),
  serviceRetry: element("service-retry"),
}

let settings = { ...DEFAULT_SETTINGS }
let providers = FALLBACK_PROVIDERS
let state = "no-video"
let currentVideo = null
let resultVideo = null
let brief = null
let runTimer = null
let noticeTimer = null

/* Settings ---------------------------------------------------------------- */

function normalizeSettings(candidate) {
  return normalizeSettingsFromCatalog(candidate, providers)
}

function selectedModel() {
  const models = providers[settings.provider]?.models ?? []
  return models.find((option) => option.id === settings.model) ?? models[0]
}

function describeSettings(source = settings) {
  const models = providers[source.provider]?.models ?? []
  const model = models.find((option) => option.id === source.model)
  return `${PROVIDER_LABELS[source.provider] ?? source.provider} · ${model?.label ?? source.model} · ${source.reasoning}`
}

async function saveSettings() {
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings })
}

function fillSelect(select, options, value) {
  select.replaceChildren(
    ...options.map(({ id, label }) => {
      const option = document.createElement("option")
      option.value = id
      option.textContent = label
      option.selected = id === value
      return option
    }),
  )
}

function renderSettings() {
  for (const segment of document.querySelectorAll(".segment")) {
    const selectable = isSelectableProvider(providers, segment.dataset.provider)
    segment.disabled = !selectable
    segment.setAttribute("aria-disabled", String(!selectable))
    segment.setAttribute("aria-pressed", String(selectable && segment.dataset.provider === settings.provider))
  }

  const model = selectedModel()
  fillSelect(ui.modelSelect, providers[settings.provider]?.models ?? [], model?.id)
  if (!model) {
    ui.modelSelect.disabled = true
    ui.reasoningSelect.disabled = true
    ui.idleConfig.textContent = "No provider is available on this machine."
    ui.loadingConfig.textContent = ui.idleConfig.textContent
    return
  }
  ui.modelSelect.disabled = false
  fillSelect(
    ui.reasoningSelect,
    model.reasoning.map((reasoning) => ({ id: reasoning, label: reasoning })),
    settings.reasoning,
  )
  ui.reasoningSelect.disabled = model.reasoning.length === 1

  const description = describeSettings()
  ui.idleConfig.textContent = description
  ui.loadingConfig.textContent = description
}

/* State ------------------------------------------------------------------- */

function showState(next) {
  state = next
  for (const [name, section] of Object.entries(ui.states)) {
    section.hidden = name !== next
  }
}

function showNotice(message) {
  window.clearTimeout(noticeTimer)
  ui.notice.replaceChildren()

  const alert = document.createElement("div")
  alert.className = "alert"
  alert.setAttribute("role", "alert")
  const text = document.createElement("p")
  text.textContent = message
  alert.append(text)
  ui.notice.append(alert)

  noticeTimer = window.setTimeout(() => ui.notice.replaceChildren(), NOTICE_TIMEOUT_MS)
}

function failWith(message) {
  ui.errorMessage.textContent = message
  showState("error")
}

async function loadHealth() {
  try {
    const response = await fetch(`${API_URL}/api/health`)
    if (!response.ok) throw new TypeError("Service unavailable")
    const payload = await response.json()
    if (!payload?.providers?.codex || !payload?.providers?.claude) throw new TypeError("Service unavailable")

    providers = payload.providers
    settings = normalizeSettings(settings)
    await saveSettings()
    renderSettings()
    // A successful health check clears the offline screen. refresh() leaves that
    // state alone by design — a tab switch while the service is down must not
    // imply it came back — so recovery has to be declared here.
    if (state === "service-unavailable") state = "no-video"
    await refresh()
  } catch {
    showServiceUnavailable()
  }
}

/* Video detection --------------------------------------------------------- */

async function probeActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab?.id) return null

  try {
    const info = await chrome.tabs.sendMessage(tab.id, { type: "probe" })
    if (!info?.videoId) return null

    return {
      tabId: tab.id,
      videoId: info.videoId,
      title: info.title || cleanVideoTitle(info.documentTitle) || "Untitled video",
      channel: info.channel ?? "",
      duration: info.duration ?? null,
    }
  } catch {
    // No content script in that tab, which is how we learn it holds no video.
    return null
  }
}

function renderIdle(video) {
  ui.thumbnail.src = `https://i.ytimg.com/vi/${video.videoId}/mqdefault.jpg`
  ui.title.textContent = video.title
  ui.channel.textContent = video.channel
  ui.duration.textContent = formatDuration(video.duration)
  renderSettings()
  showState("idle")
}

// Refreshes the detected video. A finished brief is left on screen — switching
// tabs should not discard something the user is still reading.
async function refresh() {
  const video = await probeActiveTab()
  currentVideo = video

  if (state === "running" || state === "success" || state === "error" || state === "service-unavailable") return
  if (!video) {
    showState("no-video")
    return
  }
  renderIdle(video)
}

/* Run -------------------------------------------------------------------- */

function stageFor(progress) {
  return [...LOADING_STAGES].reverse().find((stage) => progress >= stage.at) ?? LOADING_STAGES[0]
}

function stopRunTimer() {
  if (!runTimer) return
  window.clearInterval(runTimer)
  runTimer = null
}

function showServiceUnavailable() {
  stopRunTimer()
  showState("service-unavailable")
}

async function distill() {
  if (!currentVideo) {
    showState("no-video")
    return
  }

  const video = currentVideo
  const startedAt = Date.now()

  if (!isSelectableProvider(providers, settings.provider)) {
    failWith(`${PROVIDER_LABELS[settings.provider]} CLI is not available on this machine.`)
    return
  }

  renderSettings()
  ui.loadingStage.textContent = LOADING_STAGES[0].label
  ui.loadingElapsed.textContent = formatElapsed(0)
  showState("running")

  runTimer = window.setInterval(() => {
    const elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000)
    ui.loadingElapsed.textContent = formatElapsed(elapsedSeconds)
    ui.loadingStage.textContent = stageFor(elapsedSeconds).label
  }, 250)

  try {
    const response = await fetch(`${API_URL}/api/summarize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: `https://www.youtube.com/watch?v=${video.videoId}`,
        provider: settings.provider,
        model: settings.model,
        reasoning: settings.reasoning,
      }),
    })
    const payload = await response.json()
    if (!response.ok) throw new Error(payload.detail || "The summary could not be generated.")

    stopRunTimer()
    resultVideo = video
    brief = payload
    const moments = extractMoments(payload.summary)
    renderResult(payload, moments.length)
    await sendMoments(video, moments)
  } catch (error) {
    stopRunTimer()
    if (error instanceof TypeError) {
      showServiceUnavailable()
      return
    }
    failWith(error instanceof Error ? error.message : "Something went wrong.")
  }
}

/* Result ----------------------------------------------------------------- */

function renderTimings(payload) {
  const rows = payload.timings.map((timing) => {
    const row = document.createElement("div")
    row.className = "timing-row"
    const label = document.createElement("span")
    label.textContent = timing.label
    const value = document.createElement("span")
    value.textContent = formatStepDuration(timing.seconds)
    row.append(label, value)
    return row
  })

  const config = document.createElement("p")
  config.className = "timing-config"
  config.textContent = describeSettings(payload)

  ui.timings.replaceChildren(...rows, config)
}

function renderSections(payload) {
  const articles = splitSummary(payload.summary).map((section, index) => {
    const article = document.createElement("article")
    article.className = "section"

    const number = document.createElement("p")
    number.className = "section-number"
    number.textContent = String(index + 1).padStart(2, "0")

    const body = document.createElement("div")
    const heading = document.createElement("h3")
    heading.className = "section-title"
    heading.textContent = section.title

    const markdown = document.createElement("div")
    markdown.className = "summary-markdown"
    markdown.innerHTML = renderMarkdown(section.content)

    body.append(heading, markdown)
    article.append(number, body)
    return article
  })

  ui.sections.replaceChildren(...articles)
}

function renderResult(payload, momentCount) {
  ui.timingsLabel.textContent = `Ready in ${formatElapsed(payload.elapsed_seconds)}`
  ui.timings.hidden = true
  ui.timingsToggle.setAttribute("aria-expanded", "false")
  ui.openVideo.href = payload.video_url
  ui.notice.replaceChildren()
  ui.copy.textContent = "Copy"
  ui.markerStatus.textContent = momentCount
    ? `${momentCount} ${momentCount === 1 ? "moment" : "moments"} marked on the player.`
    : "No watch-guide moments found for the player."

  renderTimings(payload)
  renderSections(payload)
  showState("success")
  window.scrollTo({ top: 0 })
}

async function sendMoments(video, moments) {
  try {
    await chrome.tabs.sendMessage(video.tabId, {
      type: "set-moments",
      videoId: video.videoId,
      moments,
    })
  } catch {
    // The brief remains useful if its original tab closed during generation.
  }
}

async function clearMoments(video) {
  if (!video) return
  try {
    await chrome.tabs.sendMessage(video.tabId, {
      type: "clear-moments",
      videoId: video.videoId,
    })
  } catch {
    // The tab may have closed or navigated away since the result was made.
  }
}

async function seekTo(seconds) {
  const target = resultVideo ?? currentVideo
  if (!target) return

  try {
    const result = await chrome.tabs.sendMessage(target.tabId, { type: "seek", seconds })
    if (!result?.ok) showNotice("That tab is not playing the video any more.")
  } catch {
    showNotice("Could not reach the video tab. Reopen the video and try again.")
  }
}

async function reset() {
  const markerVideo = resultVideo
  stopRunTimer()
  brief = null
  resultVideo = null
  ui.notice.replaceChildren()
  showState("no-video")
  await clearMoments(markerVideo)
  await refresh()
}

/* Wiring ----------------------------------------------------------------- */

ui.settingsToggle.addEventListener("click", () => {
  const open = ui.settings.hidden
  ui.settings.hidden = !open
  ui.settingsToggle.setAttribute("aria-expanded", String(open))
})

for (const segment of document.querySelectorAll(".segment")) {
  segment.addEventListener("click", async () => {
    if (!isSelectableProvider(providers, segment.dataset.provider)) return
    if (segment.dataset.provider === settings.provider) return
    settings = normalizeSettings({ provider: segment.dataset.provider })
    renderSettings()
    await saveSettings()
  })
}

ui.modelSelect.addEventListener("change", async () => {
  settings = normalizeSettings({ ...settings, model: ui.modelSelect.value, reasoning: null })
  renderSettings()
  await saveSettings()
})

ui.reasoningSelect.addEventListener("change", async () => {
  settings = normalizeSettings({ ...settings, reasoning: ui.reasoningSelect.value })
  renderSettings()
  await saveSettings()
})

ui.distill.addEventListener("click", distill)
ui.reset.addEventListener("click", reset)
ui.errorReset.addEventListener("click", reset)

ui.serviceCopy.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText("youtube-distilled")
    ui.serviceCopy.textContent = "Copied"
    window.setTimeout(() => {
      ui.serviceCopy.textContent = "Copy"
    }, 1500)
  } catch {
    // The result notice lives in the success section, which is hidden here, so
    // the button itself has to carry the bad news.
    ui.serviceCopy.textContent = "Copy failed"
    window.setTimeout(() => {
      ui.serviceCopy.textContent = "Copy"
    }, 1500)
  }
})

ui.serviceRetry.addEventListener("click", async () => {
  ui.serviceRetry.disabled = true
  await loadHealth()
  ui.serviceRetry.disabled = false
})

ui.timingsToggle.addEventListener("click", () => {
  const open = ui.timings.hidden
  ui.timings.hidden = !open
  ui.timingsToggle.setAttribute("aria-expanded", String(open))
})

ui.copy.addEventListener("click", async () => {
  if (!brief) return
  try {
    await navigator.clipboard.writeText(brief.summary)
    ui.copy.textContent = "Copied"
    window.setTimeout(() => {
      ui.copy.textContent = "Copy"
    }, 1500)
  } catch {
    showNotice("Copying was blocked. Select the text and copy manually.")
  }
})

ui.sections.addEventListener("click", (event) => {
  const button = event.target instanceof Element ? event.target.closest("[data-seconds]") : null
  if (button) seekTo(Number(button.dataset.seconds))
})

ui.thumbnail.addEventListener("error", () => {
  ui.thumbnail.removeAttribute("src")
})

chrome.tabs.onActivated.addListener(() => refresh())
chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
  if (changeInfo.status === "complete" || changeInfo.url) refresh()
})
chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "video-changed") refresh()
})

async function start() {
  const stored = await chrome.storage.local.get(SETTINGS_KEY)
  settings = normalizeSettings(stored?.[SETTINGS_KEY])
  renderSettings()
  await loadHealth()
}

start()
