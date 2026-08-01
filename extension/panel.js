// The side panel. Owns the state machine and all rendering.
//
// Video detection and timecode seeking stay in the content script. This panel
// owns the local API requests, settings, and rendering.
//
// One panel serves every tab in the window, so it keeps a run per video rather
// than a single current one: the service distils several videos at once, and
// switching tabs has to switch which of those runs is on screen.

import { drawDiagrams } from "./diagrams.js"
import { formatDuration, formatElapsed, formatStepDuration, cleanVideoTitle } from "./format.js"
import { renderMarkdown, splitSummary } from "./markdown.js"
import { extractMoments } from "./moments.js"
import { DEFAULT_SETTINGS, FALLBACK_PROVIDERS, isSelectableProvider, normalizeSettings as normalizeSettingsFromCatalog } from "./provider-catalog.js"
import { describeRunsElsewhere, runsElsewhere } from "./runs.js"
import {
  applyTheme,
  DARK_MEDIA_QUERY,
  nextThemeMode,
  normalizeThemeMode,
  resolveTheme,
  THEME_KEY,
} from "./theme.js"

const API_URL = "http://127.0.0.1:4322"
const SETTINGS_KEY = "youtube-distilled-settings"
const NOTICE_TIMEOUT_MS = 6000
const YOUTUBE_TABS = "https://www.youtube.com/*"
// Must match the name content.js accepts.
const GRAYSCALE_PORT = "grayscale-focus"

const PROVIDER_LABELS = { codex: "Codex", claude: "Claude" }
const PROVIDER_ICONS = { codex: "icons/codex.svg", claude: "icons/claude.svg" }

const THEME_LABELS = { system: "System", light: "Light", dark: "Dark" }

// Lucide's monitor, sun, and moon, matching the web app's button.
const THEME_ICONS = {
  system:
    '<rect width="20" height="14" x="2" y="3" rx="2" /><path d="M8 21h8" /><path d="M12 17v4" />',
  light:
    '<circle cx="12" cy="12" r="4" /><path d="M12 2v2" /><path d="M12 20v2" /><path d="m4.93 4.93 1.41 1.41" /><path d="m17.66 17.66 1.41 1.41" /><path d="M2 12h2" /><path d="M20 12h2" /><path d="m6.34 17.66-1.41 1.41" /><path d="m19.07 4.93-1.41 1.41" />',
  dark: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />',
}

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
  pickerMark: element("picker-mark"),
  themeToggle: element("theme-toggle"),
  themeIcon: element("theme-icon"),
  grayscaleToggle: element("grayscale-toggle"),
  modelSelect: element("model-select"),
  reasoningRange: element("reasoning-range"),
  reasoningValue: element("reasoning-value"),
  reasoningSingle: element("reasoning-single"),
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
  otherRuns: element("other-runs"),
  resultTitle: element("result-title"),
  resultChannel: element("result-channel"),
  notice: element("result-notice"),
  sections: element("sections"),
  errorMessage: element("error-message"),
  errorReset: element("error-reset"),
  serviceCopy: element("service-copy"),
  serviceRetry: element("service-retry"),
}

let settings = { ...DEFAULT_SETTINGS }
let providers = FALLBACK_PROVIDERS
let themeMode = "system"
let resolvedTheme = "light"
let grayscaleOn = false
// tabId -> the port carrying grayscale focus to that tab's content script.
const grayscalePorts = new Map()
let state = "no-video"
let currentVideo = null
// videoId -> { video, state, startedAt, settings, brief, momentCount, error }.
// A run outlives the tab switch that hides it, so nothing is lost by reading
// another video while it works.
const runs = new Map()
let shownVideoId = null
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

// The reasoning levels are an ordered scale, so the slider tracks the index and
// the level name is read back out of the model's own list.
function renderReasoning(model) {
  const levels = model.reasoning
  const single = levels.length < 2

  ui.reasoningValue.textContent = settings.reasoning
  ui.reasoningRange.hidden = single
  ui.reasoningSingle.hidden = !single

  if (single) {
    ui.reasoningSingle.textContent = `${model.label} runs at a single reasoning level.`
    return
  }

  ui.reasoningRange.max = String(levels.length - 1)
  ui.reasoningRange.value = String(Math.max(0, levels.indexOf(settings.reasoning)))
}

function renderSettings() {
  for (const segment of document.querySelectorAll(".segment")) {
    const selectable = isSelectableProvider(providers, segment.dataset.provider)
    segment.disabled = !selectable
    segment.setAttribute("aria-disabled", String(!selectable))
    segment.setAttribute("aria-pressed", String(selectable && segment.dataset.provider === settings.provider))
  }

  const model = selectedModel()
  ui.pickerMark.src = PROVIDER_ICONS[settings.provider] ?? PROVIDER_ICONS.codex
  fillSelect(ui.modelSelect, providers[settings.provider]?.models ?? [], model?.id)
  if (!model) {
    ui.modelSelect.disabled = true
    ui.reasoningRange.disabled = true
    ui.settingsToggle.setAttribute("aria-label", "Choose model")
    ui.idleConfig.textContent = "No provider is available on this machine."
    ui.loadingConfig.textContent = ui.idleConfig.textContent
    return
  }
  ui.modelSelect.disabled = false
  ui.reasoningRange.disabled = false
  ui.settingsToggle.setAttribute(
    "aria-label",
    `Choose model. Currently ${PROVIDER_LABELS[settings.provider] ?? settings.provider} ${model.label}.`,
  )
  renderReasoning(model)

  const description = describeSettings()
  ui.idleConfig.textContent = description
  // A run in progress keeps describing the model it was started with, whatever
  // the picker has been moved to since.
  if (shownRun()?.state !== "running") ui.loadingConfig.textContent = description
}

/* Theme -------------------------------------------------------------------- */

function renderTheme() {
  const nextMode = nextThemeMode(themeMode)
  resolvedTheme = resolveTheme(themeMode, window.matchMedia(DARK_MEDIA_QUERY).matches)
  applyTheme(resolvedTheme)
  ui.themeIcon.innerHTML = THEME_ICONS[themeMode]
  ui.themeToggle.setAttribute(
    "aria-label",
    `Theme: ${THEME_LABELS[themeMode].toLowerCase()}. Switch to ${THEME_LABELS[nextMode].toLowerCase()}.`,
  )

  // Mermaid bakes its colours into the SVG it returns, so a diagram on screen
  // has to be drawn again rather than restyled.
  drawDiagrams(ui.sections, resolvedTheme)
}

async function saveThemeMode() {
  await chrome.storage.local.set({ [THEME_KEY]: themeMode })
}

/* Grayscale focus --------------------------------------------------------- */

function renderGrayscale() {
  ui.grayscaleToggle.setAttribute("aria-pressed", String(grayscaleOn))
  ui.grayscaleToggle.setAttribute(
    "aria-label",
    grayscaleOn
      ? "Restore the page's color"
      : "Grayscale the page except the video",
  )
}

// Grayscale focus lasts only as long as this panel. The toggle is held in memory
// and never written to storage, and it reaches the page down a port per tab: when
// the panel closes, its document goes and the ports go with it, so every tab
// restores its own color without the panel having to undo anything on the way
// out — which a closing document cannot be relied on to do. Reopening the panel
// therefore starts from off, and toggling it is the only way back to gray.
//
// One port per tab, reused until the tab drops it. A tab that has no content
// script yet disconnects immediately; the next sendGrayscale() reconnects it.
function grayscalePort(tabId) {
  const existing = grayscalePorts.get(tabId)
  if (existing) return existing

  const port = chrome.tabs.connect(tabId, { name: GRAYSCALE_PORT })
  port.onDisconnect.addListener(() => {
    if (grayscalePorts.get(tabId) === port) grayscalePorts.delete(tabId)
  })
  grayscalePorts.set(tabId, port)
  return port
}

// Every YouTube tab, not just the active one: the toggle is about the browsing
// session rather than the video currently on screen.
async function sendGrayscale() {
  const tabs = await chrome.tabs.query({ url: YOUTUBE_TABS })
  for (const tab of tabs) {
    if (tab.id === undefined) continue
    try {
      grayscalePort(tab.id).postMessage({ on: grayscaleOn })
    } catch {
      // The tab closed or reloaded between the query and the post. It comes back
      // with a fresh content script, which announces itself and gets picked up.
      grayscalePorts.delete(tab.id)
    }
  }
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

/* Runs -------------------------------------------------------------------- */

function shownRun() {
  return (shownVideoId && runs.get(shownVideoId)) || null
}

// Runs the panel is not currently showing are invisible work, so they are
// counted out loud. Otherwise a tab switch looks like the run was dropped.
function renderOtherRuns() {
  const elsewhere = runsElsewhere(runs, shownVideoId)
  ui.otherRuns.textContent = describeRunsElsewhere(elsewhere)
  ui.otherRuns.hidden = elsewhere === 0
}

// Points the panel at one video: its run if it has one, the idle card if not.
function showVideo(video) {
  stopRunTimer()
  shownVideoId = video.videoId
  const run = runs.get(video.videoId)

  if (!run) renderIdle(video)
  else if (run.state === "running") renderRunning(run)
  else if (run.state === "error") failWith(run.error)
  else renderResult(run)

  renderOtherRuns()
}

// Refreshes the detected video. A tab holding no video leaves the panel alone —
// switching away should not discard a brief being read or hide a live run.
async function refresh() {
  const video = await probeActiveTab()
  currentVideo = video

  // Runs on every tab change, load, and content-script announcement, which is
  // where a tab that has no port yet — freshly opened or reloaded — gets one.
  if (grayscaleOn) await sendGrayscale()

  if (state === "service-unavailable") return
  if (!video) {
    if (!shownRun()) showState("no-video")
    renderOtherRuns()
    return
  }
  showVideo(video)
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

function tickRun(run) {
  const elapsedSeconds = Math.floor((Date.now() - run.startedAt) / 1000)
  ui.loadingElapsed.textContent = formatElapsed(elapsedSeconds)
  ui.loadingStage.textContent = stageFor(elapsedSeconds).label
}

// One timer, and it follows whichever run is on screen: the others carry their
// own start time, so their elapsed reading is correct when they come back up.
function renderRunning(run) {
  stopRunTimer()
  ui.loadingConfig.textContent = describeSettings(run.settings)
  tickRun(run)
  showState("running")
  runTimer = window.setInterval(() => tickRun(run), 250)
}

// "New" can retire a run while its CLI is still working. Its result then belongs
// to nothing on screen and is dropped rather than painted over what replaced it.
function stillWanted(run) {
  return runs.get(run.video.videoId) === run
}

function repaint(video) {
  if (shownVideoId === video.videoId) showVideo(video)
  else renderOtherRuns()
}

async function distill() {
  if (!currentVideo) {
    showState("no-video")
    return
  }

  if (!isSelectableProvider(providers, settings.provider)) {
    failWith(`${PROVIDER_LABELS[settings.provider]} CLI is not available on this machine.`)
    return
  }

  const video = currentVideo
  const run = {
    video,
    state: "running",
    startedAt: Date.now(),
    settings: { ...settings },
    brief: null,
    momentCount: 0,
    error: "",
  }
  runs.set(video.videoId, run)

  renderSettings()
  setSettingsOpen(false)
  showVideo(video)

  try {
    const response = await fetch(`${API_URL}/api/summarize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: `https://www.youtube.com/watch?v=${video.videoId}`,
        provider: run.settings.provider,
        model: run.settings.model,
        reasoning: run.settings.reasoning,
      }),
    })
    const payload = await response.json()
    if (!response.ok) throw new Error(payload.detail || "The summary could not be generated.")
    if (!stillWanted(run)) return

    const moments = extractMoments(payload.summary)
    run.state = "success"
    run.brief = payload
    run.momentCount = moments.length
    // The markers go to the run's own tab, whichever tab is in front now.
    await sendMoments(video, moments)
  } catch (error) {
    if (!stillWanted(run)) return
    if (error instanceof TypeError) {
      runs.delete(video.videoId)
      if (shownVideoId === video.videoId) showServiceUnavailable()
      renderOtherRuns()
      return
    }
    run.state = "error"
    run.error = error instanceof Error ? error.message : "Something went wrong."
  }

  repaint(video)
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
  // Asynchronous, because mermaid is only loaded once a brief actually has a
  // diagram in it. Until it lands, each diagram shows its own source.
  drawDiagrams(ui.sections, resolvedTheme)
}

function renderResult(run) {
  const { brief: payload, momentCount, video } = run

  // The video's own name heads the brief: the panel outlives the tab that made
  // it, so by the time it is read the thumbnail above may be another video.
  ui.resultTitle.textContent = video.title || "Summary"
  ui.resultChannel.textContent = video.channel
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
  const target = shownRun()?.video ?? currentVideo
  if (!target) return

  try {
    const result = await chrome.tabs.sendMessage(target.tabId, { type: "seek", seconds })
    if (!result?.ok) showNotice("That tab is not playing the video any more.")
  } catch {
    showNotice("Could not reach the video tab. Reopen the video and try again.")
  }
}

// Retires only the run on screen. Runs on other tabs are none of its business.
async function reset() {
  const run = shownRun()
  stopRunTimer()
  if (run) runs.delete(run.video.videoId)
  shownVideoId = null
  ui.notice.replaceChildren()
  showState("no-video")
  await clearMoments(run?.video)
  await refresh()
}

/* Wiring ----------------------------------------------------------------- */

function setSettingsOpen(open, { restoreFocus = false } = {}) {
  if (ui.settings.hidden === !open) return

  ui.settings.hidden = !open
  ui.settingsToggle.setAttribute("aria-expanded", String(open))
  if (!open && restoreFocus) ui.settingsToggle.focus()
}

ui.settingsToggle.addEventListener("click", () => setSettingsOpen(ui.settings.hidden))

// A popover has to close the way one is expected to: clicking away, or Escape.
document.addEventListener("pointerdown", (event) => {
  if (ui.settings.hidden) return
  const target = event.target
  if (target instanceof Node && ui.settings.parentElement?.contains(target)) return
  setSettingsOpen(false)
})

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || ui.settings.hidden) return
  event.preventDefault()
  setSettingsOpen(false, { restoreFocus: true })
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

function reasoningLevelAt(index) {
  return selectedModel()?.reasoning?.[Number(index)]
}

// The readout follows the thumb, but the write waits for the drag to end so a
// single gesture is one storage write rather than dozens.
ui.reasoningRange.addEventListener("input", () => {
  const level = reasoningLevelAt(ui.reasoningRange.value)
  if (level) ui.reasoningValue.textContent = level
})

ui.reasoningRange.addEventListener("change", async () => {
  const level = reasoningLevelAt(ui.reasoningRange.value)
  if (!level) return
  settings = normalizeSettings({ ...settings, reasoning: level })
  renderSettings()
  await saveSettings()
})

ui.themeToggle.addEventListener("click", async () => {
  themeMode = nextThemeMode(themeMode)
  renderTheme()
  await saveThemeMode()
})

ui.grayscaleToggle.addEventListener("click", async () => {
  grayscaleOn = !grayscaleOn
  renderGrayscale()
  await sendGrayscale()
})

// "System" has to keep tracking the OS while the panel is open.
window.matchMedia(DARK_MEDIA_QUERY).addEventListener("change", () => {
  if (themeMode === "system") renderTheme()
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
  const brief = shownRun()?.brief
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
  // Grayscale is deliberately absent here: it is a per-session toggle, so every
  // panel opens with the page in color.
  const stored = await chrome.storage.local.get([SETTINGS_KEY, THEME_KEY])
  // An earlier version did store the toggle. Clearing it keeps the promise that
  // nothing about grayscale outlives the panel, on upgraded installs too.
  chrome.storage.local.remove("youtube-distilled-grayscale")
  settings = normalizeSettings(stored?.[SETTINGS_KEY])
  themeMode = normalizeThemeMode(stored?.[THEME_KEY])
  renderTheme()
  renderGrayscale()
  renderSettings()
  await loadHealth()
}

start()
