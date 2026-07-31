// The side panel. Owns the state machine and all rendering.
//
// Two things here are real: the video reported by the content script, and
// timecode seeking, which drives the page's own player. The brief itself is
// sample data — see mock-brief.js.

import { formatDuration, formatElapsed, formatStepDuration, cleanVideoTitle } from "./format.js"
import { renderMarkdown, splitSummary } from "./markdown.js"
import { createMockBrief } from "./mock-brief.js"

const SETTINGS_KEY = "youtube-distilled-settings"
const SIMULATED_RUN_MS = 7000
const NOTICE_TIMEOUT_MS = 6000

// Copied from MODEL_CATALOG in backend/main.py. Provider availability cannot be
// known without the API, so both are offered in the shell.
const MODEL_CATALOG = {
  codex: [
    { id: "gpt-5.6-sol", label: "GPT-5.6 Sol", reasoning: ["low", "medium", "high", "xhigh", "max"], default_reasoning: "low" },
    { id: "gpt-5.5", label: "GPT-5.5", reasoning: ["low", "medium", "high", "xhigh"], default_reasoning: "medium" },
    { id: "gpt-5.4", label: "GPT-5.4", reasoning: ["low", "medium", "high", "xhigh"], default_reasoning: "medium" },
    { id: "gpt-5.4-mini", label: "GPT-5.4 Mini", reasoning: ["low", "medium", "high", "xhigh"], default_reasoning: "low" },
  ],
  claude: [
    { id: "claude-sonnet-5", label: "Claude Sonnet 5", reasoning: ["low", "medium", "high", "xhigh", "max"], default_reasoning: "medium" },
    { id: "claude-opus-5", label: "Claude Opus 5", reasoning: ["low", "medium", "high", "xhigh", "max"], default_reasoning: "high" },
    { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", reasoning: ["default"], default_reasoning: "default" },
  ],
}

const PROVIDER_LABELS = { codex: "Codex", claude: "Claude" }

const DEFAULT_SETTINGS = { provider: "codex", model: "gpt-5.6-sol", reasoning: "low" }

// The app's five stage labels, as fractions of the run rather than fixed
// seconds, because the simulated run is far shorter than a real analysis.
const LOADING_STAGES = [
  { at: 0, label: "Opening the video context" },
  { at: 0.08, label: "Finding transcript and chapters" },
  { at: 0.24, label: "Analyzing the argument" },
  { at: 0.52, label: "Selecting the moments worth watching" },
  { at: 0.8, label: "Compressing the final brief" },
]

const element = (id) => document.getElementById(id)

const ui = {
  states: {
    "no-video": element("state-no-video"),
    idle: element("state-idle"),
    running: element("state-running"),
    success: element("state-success"),
    error: element("state-error"),
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
  notice: element("result-notice"),
  sections: element("sections"),
  errorMessage: element("error-message"),
  errorReset: element("error-reset"),
}

let settings = { ...DEFAULT_SETTINGS }
let state = "no-video"
let currentVideo = null
let resultVideo = null
let brief = null
let runTimer = null
let noticeTimer = null

/* Settings ---------------------------------------------------------------- */

function normalizeSettings(candidate) {
  const provider = candidate?.provider === "claude" ? "claude" : "codex"
  const models = MODEL_CATALOG[provider]
  const model = models.find((option) => option.id === candidate?.model) ?? models[0]
  const reasoning = model.reasoning.includes(candidate?.reasoning)
    ? candidate.reasoning
    : model.default_reasoning

  return { provider, model: model.id, reasoning }
}

function selectedModel() {
  const models = MODEL_CATALOG[settings.provider]
  return models.find((option) => option.id === settings.model) ?? models[0]
}

function describeSettings(source = settings) {
  const models = MODEL_CATALOG[source.provider] ?? []
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
    segment.setAttribute("aria-pressed", String(segment.dataset.provider === settings.provider))
  }

  const model = selectedModel()
  fillSelect(ui.modelSelect, MODEL_CATALOG[settings.provider], model.id)
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

  if (state === "running" || state === "success" || state === "error") return
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

function distill() {
  if (!currentVideo) {
    showState("no-video")
    return
  }

  const video = currentVideo
  const startedAt = Date.now()

  renderSettings()
  ui.loadingStage.textContent = LOADING_STAGES[0].label
  ui.loadingElapsed.textContent = formatElapsed(0)
  showState("running")

  runTimer = window.setInterval(() => {
    const elapsedMs = Date.now() - startedAt
    ui.loadingElapsed.textContent = formatElapsed(Math.floor(elapsedMs / 1000))
    ui.loadingStage.textContent = stageFor(elapsedMs / SIMULATED_RUN_MS).label

    if (elapsedMs < SIMULATED_RUN_MS) return

    window.clearInterval(runTimer)
    runTimer = null
    resultVideo = video
    brief = createMockBrief({
      videoId: video.videoId,
      settings,
      elapsedSeconds: elapsedMs / 1000,
    })
    renderResult(brief)
  }, 250)
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

function renderResult(payload) {
  ui.timingsLabel.textContent = `Ready in ${formatElapsed(payload.elapsed_seconds)}`
  ui.timings.hidden = true
  ui.timingsToggle.setAttribute("aria-expanded", "false")
  ui.openVideo.href = payload.video_url
  ui.notice.replaceChildren()
  ui.copy.textContent = "Copy"

  renderTimings(payload)
  renderSections(payload)
  showState("success")
  window.scrollTo({ top: 0 })
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
  if (runTimer) {
    window.clearInterval(runTimer)
    runTimer = null
  }
  brief = null
  resultVideo = null
  ui.notice.replaceChildren()
  showState("no-video")
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
  await refresh()
}

start()
