import { type FormEvent, type PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from "react"
import {
  ArrowRight,
  Check,
  ChevronDown,
  CircleAlert,
  Clipboard,
  ExternalLink,
  Maximize2,
  Minimize2,
  RotateCcw,
  Settings2,
  X,
} from "lucide-react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import claudeLogo from "@lobehub/icons-static-svg/icons/claude.svg"
import chatGptLogo from "@lobehub/icons-static-svg/icons/openai.svg"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { nearestPlayerCorner, type PlayerCorner } from "@/src/player-position"
import { linkifyTimecodes } from "@/src/timecodes"

const API_URL = "http://127.0.0.1:4322"
const SETTINGS_KEY = "youtube-distilled-settings"

type AppState = "idle" | "running" | "success" | "error"
type ProviderId = "codex" | "claude"

type ModelOption = {
  id: string
  label: string
  description: string
  reasoning: string[]
  default_reasoning: string
}

type ProviderOption = {
  available: boolean
  models: ModelOption[]
}

type ProviderCatalog = Record<ProviderId, ProviderOption>

type AppSettings = {
  provider: ProviderId
  model: string
  reasoning: string
}

type TimingItem = {
  label: string
  seconds: number
}

type SummaryResponse = {
  summary: string
  video_url: string
  elapsed_seconds: number
  provider: ProviderId
  model: string
  reasoning: string
  timings: TimingItem[]
}

type SummarySection = {
  title: string
  content: string
}

type FollowupResponse = {
  answer: string
  elapsed_seconds: number
  provider: ProviderId
  model: string
  reasoning: string
}

type FollowupItem = {
  question: string
  answer: string
  elapsed: number
}

type FollowupState = "idle" | "running" | "error"

type PlayerState = {
  seconds: number
  label: string
  nonce: number
}

type PlayerPosition = {
  left: number
  top: number
}

const PLAYER_EDGE_GAP = 16
const playerCornerClasses: Record<PlayerCorner, string> = {
  "top-left": "top-4 left-4",
  "top-right": "top-4 right-4",
  "bottom-left": "bottom-4 left-4",
  "bottom-right": "right-4 bottom-4",
}

const providerLabels: Record<ProviderId, string> = {
  codex: "Codex",
  claude: "Claude",
}

const providerLogos: Record<ProviderId, string> = {
  codex: chatGptLogo,
  claude: claudeLogo,
}

const fallbackProviders: ProviderCatalog = {
  codex: {
    available: true,
    models: [
      { id: "gpt-5.6-sol", label: "GPT-5.6 Sol", description: "Best quality", reasoning: ["low", "medium", "high", "xhigh", "max"], default_reasoning: "low" },
      { id: "gpt-5.5", label: "GPT-5.5", description: "Strong all-rounder", reasoning: ["low", "medium", "high", "xhigh"], default_reasoning: "medium" },
      { id: "gpt-5.4", label: "GPT-5.4", description: "Balanced", reasoning: ["low", "medium", "high", "xhigh"], default_reasoning: "medium" },
      { id: "gpt-5.4-mini", label: "GPT-5.4 Mini", description: "Fastest Codex option", reasoning: ["low", "medium", "high", "xhigh"], default_reasoning: "low" },
    ],
  },
  claude: {
    available: true,
    models: [
      { id: "claude-sonnet-5", label: "Claude Sonnet 5", description: "Best balance", reasoning: ["low", "medium", "high", "xhigh", "max"], default_reasoning: "medium" },
      { id: "claude-opus-5", label: "Claude Opus 5", description: "Deepest analysis", reasoning: ["low", "medium", "high", "xhigh", "max"], default_reasoning: "high" },
      { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", description: "Fastest Claude option", reasoning: ["default"], default_reasoning: "default" },
    ],
  },
}

const defaultSettings: AppSettings = {
  provider: "codex",
  model: "gpt-5.6-sol",
  reasoning: "low",
}

const loadingStages = [
  { after: 0, label: "Opening the video context" },
  { after: 8, label: "Finding transcript and chapters" },
  { after: 35, label: "Analyzing the argument" },
  { after: 90, label: "Selecting the moments worth watching" },
  { after: 180, label: "Compressing the final brief" },
]

function loadSettings(): AppSettings {
  try {
    const saved = window.localStorage.getItem(SETTINGS_KEY)
    if (!saved) return defaultSettings
    const parsed = JSON.parse(saved) as AppSettings
    if (parsed.provider !== "codex" && parsed.provider !== "claude") return defaultSettings
    return parsed
  } catch {
    return defaultSettings
  }
}

function isYouTubeUrl(value: string) {
  try {
    const host = new URL(value).hostname.toLowerCase().replace(/^www\./, "")
    return [
      "youtube.com",
      "m.youtube.com",
      "music.youtube.com",
      "youtu.be",
      "youtube-nocookie.com",
    ].includes(host)
  } catch {
    return false
  }
}

function splitSummary(markdown: string): SummarySection[] {
  const headingPattern = /^##\s+(.+)$/gm
  const matches = [...markdown.matchAll(headingPattern)]

  if (!matches.length) return [{ title: "Video brief", content: markdown.trim() }]

  return matches.map((match, index) => {
    const start = (match.index ?? 0) + match[0].length
    const end = matches[index + 1]?.index ?? markdown.length
    return {
      title: match[1].replace(/^\d+\.\s*/, "").trim(),
      content: markdown.slice(start, end).trim(),
    }
  })
}

function formatElapsed(seconds: number) {
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`
}

function formatStepDuration(seconds: number) {
  if (seconds < 10) return `${seconds.toFixed(1)}s`
  return formatElapsed(Math.round(seconds))
}

function getVideoId(value: string) {
  try {
    return new URL(value).searchParams.get("v")
  } catch {
    return null
  }
}

function BriefMarkdown({
  content,
  onTimecode,
}: {
  content: string
  onTimecode: (label: string, seconds: number) => void
}) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ children, href }) => {
          if (href?.startsWith("#t=")) {
            const seconds = Number(href.slice(3))
            const label = String(children)
            return (
              <Button
                variant="link"
                size="xs"
                className="timecode-link h-auto min-w-0 rounded-none p-0 font-normal"
                onClick={() => onTimecode(label, seconds)}
              >
                {children}
              </Button>
            )
          }

          return <a href={href} target="_blank" rel="noreferrer">{children}</a>
        },
      }}
    >
      {linkifyTimecodes(content)}
    </ReactMarkdown>
  )
}

export default function App() {
  const [url, setUrl] = useState("")
  const [state, setState] = useState<AppState>("idle")
  const [summary, setSummary] = useState("")
  const [videoUrl, setVideoUrl] = useState("")
  const [error, setError] = useState("")
  const [elapsed, setElapsed] = useState(0)
  const [completedIn, setCompletedIn] = useState(0)
  const [copied, setCopied] = useState(false)
  const [player, setPlayer] = useState<PlayerState | null>(null)
  const [playerCorner, setPlayerCorner] = useState<PlayerCorner>("bottom-right")
  const [playerPosition, setPlayerPosition] = useState<PlayerPosition | null>(null)
  const [isPlayerDragging, setIsPlayerDragging] = useState(false)
  const [isPlayerFullscreen, setIsPlayerFullscreen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [timingsOpen, setTimingsOpen] = useState(false)
  const [settings, setSettings] = useState<AppSettings>(loadSettings)
  const [providers, setProviders] = useState<ProviderCatalog>(fallbackProviders)
  const [timings, setTimings] = useState<TimingItem[]>([])
  const [resultSettings, setResultSettings] = useState<AppSettings>(defaultSettings)
  const [followups, setFollowups] = useState<FollowupItem[]>([])
  const [followupInput, setFollowupInput] = useState("")
  const [followupState, setFollowupState] = useState<FollowupState>("idle")
  const [followupError, setFollowupError] = useState("")
  const resultRef = useRef<HTMLDivElement>(null)
  const playerRef = useRef<HTMLDivElement>(null)
  const playerDragOffsetRef = useRef({ x: 0, y: 0 })
  const playerPositionRef = useRef<PlayerPosition | null>(null)
  const playerDraggingRef = useRef(false)
  const sections = useMemo(() => splitSummary(summary), [summary])
  const videoId = getVideoId(videoUrl)
  const provider = providers[settings.provider]
  const selectedModel = provider.models.find((model) => model.id === settings.model) ?? provider.models[0]
  const loadingStage = [...loadingStages].reverse().find((stage) => elapsed >= stage.after) ?? loadingStages[0]

  useEffect(() => {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
  }, [settings])

  useEffect(() => {
    function syncFullscreenState() {
      setIsPlayerFullscreen(document.fullscreenElement === playerRef.current)
    }

    document.addEventListener("fullscreenchange", syncFullscreenState)
    return () => document.removeEventListener("fullscreenchange", syncFullscreenState)
  }, [])

  useEffect(() => {
    let active = true
    fetch(`${API_URL}/api/health`)
      .then((response) => response.json())
      .then((payload: { providers?: ProviderCatalog }) => {
        if (!active || !payload.providers) return
        setProviders(payload.providers)
        setSettings((current) => {
          const currentProvider = payload.providers?.[current.provider]
          const currentModel = currentProvider?.models.find((model) => model.id === current.model)
          if (currentModel && currentModel.reasoning.includes(current.reasoning)) return current
          const nextModel = currentModel ?? currentProvider?.models[0]
          if (!nextModel) return defaultSettings
          return {
            provider: current.provider,
            model: nextModel.id,
            reasoning: nextModel.default_reasoning,
          }
        })
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (state !== "running") return
    const startedAt = Date.now()
    const timer = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt) / 1000))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [state])

  useEffect(() => {
    if (state !== "success") return
    const timer = window.setTimeout(() => {
      resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
    }, 100)
    return () => window.clearTimeout(timer)
  }, [state])

  function changeProvider(nextProvider: ProviderId) {
    const nextModel = providers[nextProvider].models[0]
    setSettings({
      provider: nextProvider,
      model: nextModel.id,
      reasoning: nextModel.default_reasoning,
    })
  }

  function changeModel(modelId: string) {
    const nextModel = provider.models.find((model) => model.id === modelId)
    if (!nextModel) return
    setSettings((current) => ({
      ...current,
      model: nextModel.id,
      reasoning: nextModel.default_reasoning,
    }))
  }

  async function summarize(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmedUrl = url.trim()

    if (!isYouTubeUrl(trimmedUrl)) {
      setError("Paste a valid YouTube video URL.")
      setState("error")
      return
    }
    if (!provider.available) {
      setError(`${providerLabels[settings.provider]} CLI is not available on this machine.`)
      setState("error")
      return
    }

    setElapsed(0)
    setState("running")
    setError("")
    setSummary("")
    setTimings([])
    setTimingsOpen(false)
    setCopied(false)
    setSettingsOpen(false)
    setFollowups([])
    setFollowupInput("")
    setFollowupState("idle")
    setFollowupError("")

    try {
      const response = await fetch(`${API_URL}/api/summarize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: trimmedUrl, ...settings }),
      })
      const payload = (await response.json()) as SummaryResponse & { detail?: string }

      if (!response.ok) throw new Error(payload.detail || "The summary could not be generated.")

      setSummary(payload.summary)
      setVideoUrl(payload.video_url)
      setCompletedIn(payload.elapsed_seconds)
      setTimings(payload.timings)
      setResultSettings({
        provider: payload.provider,
        model: payload.model,
        reasoning: payload.reasoning,
      })
      setState("success")
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : "Something went wrong."
      setError(
        message === "Failed to fetch"
          ? "The local Python service is not reachable. Restart with youtube-distilled."
          : message,
      )
      setState("error")
    }
  }

  async function askFollowup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const question = followupInput.trim()
    if (!question || followupState === "running") return

    setFollowupState("running")
    setFollowupError("")

    try {
      const response = await fetch(`${API_URL}/api/followup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: videoUrl,
          question,
          ...resultSettings,
          summary,
          history: followups.flatMap((item) => [
            { role: "user", content: item.question },
            { role: "assistant", content: item.answer },
          ]),
        }),
      })
      const payload = (await response.json()) as FollowupResponse & { detail?: string }

      if (!response.ok) throw new Error(payload.detail || "The answer could not be generated.")

      setFollowups((current) => [
        ...current,
        { question, answer: payload.answer, elapsed: payload.elapsed_seconds },
      ])
      setFollowupInput("")
      setFollowupState("idle")
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : "Something went wrong."
      setFollowupError(
        message === "Failed to fetch"
          ? "The local Python service is not reachable. Restart with youtube-distilled."
          : message,
      )
      setFollowupState("error")
    }
  }

  async function copySummary() {
    await navigator.clipboard.writeText(summary)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  function reset() {
    setState("idle")
    setSummary("")
    setVideoUrl("")
    setError("")
    setUrl("")
    setPlayer(null)
    playerDraggingRef.current = false
    setPlayerPosition(null)
    playerPositionRef.current = null
    setTimingsOpen(false)
    setFollowups([])
    setFollowupInput("")
    setFollowupState("idle")
    setFollowupError("")
    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  function playTimecode(label: string, seconds: number) {
    setPlayer({ label, seconds, nonce: Date.now() })
  }

  async function togglePlayerFullscreen() {
    const playerElement = playerRef.current
    if (!playerElement) return

    if (document.fullscreenElement === playerElement) {
      await document.exitFullscreen()
      return
    }

    if (document.fullscreenElement) await document.exitFullscreen()
    await playerElement.requestFullscreen()
  }

  function startPlayerDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const target = event.target
    if (
      isPlayerFullscreen
      || event.button !== 0
      || (target instanceof Element && target.closest("button"))
    ) return

    const playerElement = playerRef.current
    if (!playerElement) return

    const bounds = playerElement.getBoundingClientRect()
    const position = { left: bounds.left, top: bounds.top }
    playerDragOffsetRef.current = {
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top,
    }
    playerPositionRef.current = position
    playerDraggingRef.current = true
    setPlayerPosition(position)
    setIsPlayerDragging(true)
    event.currentTarget.setPointerCapture(event.pointerId)
    event.preventDefault()
  }

  function movePlayer(event: ReactPointerEvent<HTMLDivElement>) {
    if (!playerDraggingRef.current) return
    const playerElement = playerRef.current
    if (!playerElement) return

    const maxLeft = Math.max(PLAYER_EDGE_GAP, window.innerWidth - playerElement.offsetWidth - PLAYER_EDGE_GAP)
    const maxTop = Math.max(PLAYER_EDGE_GAP, window.innerHeight - playerElement.offsetHeight - PLAYER_EDGE_GAP)
    const position = {
      left: Math.min(maxLeft, Math.max(PLAYER_EDGE_GAP, event.clientX - playerDragOffsetRef.current.x)),
      top: Math.min(maxTop, Math.max(PLAYER_EDGE_GAP, event.clientY - playerDragOffsetRef.current.y)),
    }
    playerPositionRef.current = position
    setPlayerPosition(position)
  }

  function finishPlayerDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (!playerDraggingRef.current) return
    const playerElement = playerRef.current
    const position = playerPositionRef.current

    if (playerElement && position) {
      setPlayerCorner(nearestPlayerCorner(
        position,
        { width: playerElement.offsetWidth, height: playerElement.offsetHeight },
        { width: window.innerWidth, height: window.innerHeight },
      ))
    }

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    playerDraggingRef.current = false
    playerPositionRef.current = null
    setPlayerPosition(null)
    setIsPlayerDragging(false)
  }

  async function closePlayer() {
    if (document.fullscreenElement === playerRef.current) await document.exitFullscreen()
    playerDraggingRef.current = false
    playerPositionRef.current = null
    setPlayerPosition(null)
    setIsPlayerDragging(false)
    setPlayer(null)
  }

  return (
    <TooltipProvider>
      <main className="min-h-screen bg-white text-black selection:bg-black selection:text-white">
        <Popover open={settingsOpen} onOpenChange={setSettingsOpen}>
          <PopoverTrigger
            render={
              <Button
                variant="outline"
                size="icon-lg"
                className="fixed top-4 right-4 z-50 rounded-full bg-white text-black/55 shadow-sm hover:text-black"
                aria-label="Open settings"
              />
            }
          >
            <Settings2 />
          </PopoverTrigger>
          <PopoverContent
            align="end"
            sideOffset={8}
            className="w-[calc(100vw-2rem)] max-w-[320px] gap-0 p-4 shadow-[0_16px_50px_rgba(0,0,0,0.12)]"
          >
            <PopoverHeader className="mb-4">
              <PopoverTitle className="font-semibold">Settings</PopoverTitle>
            </PopoverHeader>

            <Label className="mb-2 text-[10px] uppercase tracking-[0.12em] text-black/40">
              Provider
            </Label>
            <ToggleGroup
              value={[settings.provider]}
              onValueChange={(value) => {
                const nextProvider = value[0] as ProviderId | undefined
                if (nextProvider && nextProvider !== settings.provider) changeProvider(nextProvider)
              }}
              disabled={state === "running"}
              variant="outline"
              spacing={0}
              className="grid w-full grid-cols-2"
              aria-label="AI provider"
            >
              {(["codex", "claude"] as ProviderId[]).map((providerId) => (
                <ToggleGroupItem
                  key={providerId}
                  value={providerId}
                  disabled={!providers[providerId].available}
                  className="h-10 w-full gap-2 rounded-none border-black/10 text-xs text-black/50 first:rounded-l-lg last:rounded-r-lg aria-pressed:bg-black aria-pressed:text-white aria-pressed:[&_img]:invert"
                  aria-label={`Use ${providerLabels[providerId]}`}
                >
                  <img src={providerLogos[providerId]} alt="" className="size-4" aria-hidden="true" />
                  {providerLabels[providerId]}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>

            <div className="mt-5 space-y-4">
              <div className="space-y-2">
                <Label className="text-[10px] uppercase tracking-[0.12em] text-black/40" htmlFor="model-setting">
                  Model
                </Label>
                <Select
                  value={selectedModel.id}
                  disabled={state === "running"}
                  onValueChange={(value) => value && changeModel(value)}
                >
                  <SelectTrigger id="model-setting" className="h-10 w-full border-black/15">
                    <SelectValue>{selectedModel.label}</SelectValue>
                  </SelectTrigger>
                  <SelectContent align="end">
                    {provider.models.map((model) => (
                      <SelectItem key={model.id} value={model.id}>
                        <span>{model.label}</span>
                        <span className="text-xs text-black/40">{model.description}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="text-[10px] uppercase tracking-[0.12em] text-black/40" htmlFor="reasoning-setting">
                  Reasoning
                </Label>
                <Select
                  value={settings.reasoning}
                  disabled={state === "running" || selectedModel.reasoning.length === 1}
                  onValueChange={(value) => {
                    if (value) setSettings((current) => ({ ...current, reasoning: value }))
                  }}
                >
                  <SelectTrigger id="reasoning-setting" className="h-10 w-full border-black/15 capitalize">
                    <SelectValue>{settings.reasoning}</SelectValue>
                  </SelectTrigger>
                  <SelectContent align="end">
                    {selectedModel.reasoning.map((reasoning) => (
                      <SelectItem key={reasoning} value={reasoning} className="capitalize">
                        {reasoning}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <PopoverDescription className="mt-4 text-[11px] leading-4 text-black/38">
              Lower reasoning is faster. Each provider uses its existing local CLI login.
            </PopoverDescription>
          </PopoverContent>
        </Popover>

      <div className="mx-auto w-full max-w-3xl px-5 sm:px-8">
        <section className="py-24 sm:py-32">
          <div className="flex items-center gap-3 sm:gap-4">
            <img src="/logo.png" alt="" className="size-12 shrink-0 sm:size-14" aria-hidden="true" />
            <h1 className="text-5xl font-semibold tracking-[-0.055em] sm:text-6xl">YouTube Distilled.</h1>
          </div>
          <p className="mt-5 max-w-xl text-base leading-7 text-black/55">
            Paste a video. Get the argument, key ideas, and only the moments worth watching.
          </p>

          <form onSubmit={summarize} className="mt-10 flex flex-col gap-2 sm:flex-row">
            <Label htmlFor="youtube-url" className="sr-only">YouTube video URL</Label>
            <Input
              id="youtube-url"
              type="url"
              inputMode="url"
              autoComplete="url"
              value={url}
              disabled={state === "running"}
              onChange={(event) => {
                setUrl(event.target.value)
                if (state === "error") setState("idle")
              }}
              placeholder="https://youtube.com/watch?v=…"
              className="h-11 flex-1 rounded-md border-black/20 bg-white px-3.5 shadow-none placeholder:text-black/28 focus-visible:border-black focus-visible:ring-black/10"
            />
            <Button
              type="submit"
              disabled={state === "running" || !url.trim() || !provider.available}
              className="h-11 rounded-md bg-black px-5 text-white hover:bg-black/80"
            >
              {state !== "running" && <ArrowRight />}
              {state === "running" ? "Distilling" : "Summarize"}
            </Button>
          </form>

          {state === "running" && (
            <Card size="sm" className="loading-shell mt-5 flex-row py-0" aria-live="polite">
              <div className="grid size-8 shrink-0 place-items-center rounded-full border border-black/10 bg-white" aria-hidden="true">
                <img src={providerLogos[settings.provider]} alt="" className="size-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{loadingStage.label}</p>
                <p className="mt-1 truncate text-[11px] text-black/38">
                  {providerLabels[settings.provider]} · {selectedModel.label} · {settings.reasoning}
                </p>
              </div>
              <time className="font-mono text-xs tabular-nums text-black/48">{formatElapsed(elapsed)}</time>
              <div className="loading-rail" aria-hidden="true"><span /></div>
            </Card>
          )}

          {state === "error" && (
            <Alert className="mt-4 border-black/10 bg-black/[0.015] text-black/70">
              <CircleAlert className="size-4" />
              <AlertDescription className="text-black/65">{error}</AlertDescription>
            </Alert>
          )}
        </section>

        {state === "success" && (
          <section ref={resultRef} className="scroll-mt-4 py-14 sm:py-16">
            <Separator className="mb-14 bg-black/10 sm:mb-16" />
            <div className="mb-10 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <Collapsible open={timingsOpen} onOpenChange={setTimingsOpen}>
                  <CollapsibleTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="xs"
                        className="-ml-2 h-6 gap-1.5 px-2 font-mono text-[10px] uppercase tracking-[0.12em] text-black/40 hover:text-black/65"
                      />
                    }
                  >
                    Ready in {formatElapsed(completedIn)}
                    <ChevronDown className={`size-3 transition-transform ${timingsOpen ? "rotate-180" : ""}`} />
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <Card size="sm" className="mt-3 w-72 bg-black/[0.02] py-3 shadow-none">
                      <CardContent className="px-3">
                        {timings.map((timing) => (
                          <div key={timing.label} className="flex items-center justify-between py-1 text-[11px] text-black/50">
                            <span>{timing.label}</span>
                            <span className="font-mono tabular-nums text-black/65">{formatStepDuration(timing.seconds)}</span>
                          </div>
                        ))}
                        <Separator className="my-2 bg-black/8" />
                        <p className="text-[10px] text-black/35">
                          {providerLabels[resultSettings.provider]} · {resultSettings.model} · {resultSettings.reasoning}
                        </p>
                      </CardContent>
                    </Card>
                  </CollapsibleContent>
                </Collapsible>
                <h2 className="mt-2 text-3xl font-semibold tracking-[-0.04em]">Summary</h2>
              </div>
              <div className="flex gap-1">
                <Button variant="ghost" size="sm" onClick={copySummary}>
                  {copied ? <Check /> : <Clipboard />}
                  {copied ? "Copied" : "Copy"}
                </Button>
                <Button nativeButton={false} variant="ghost" size="sm" render={<a href={videoUrl} target="_blank" rel="noreferrer" />}>
                  <ExternalLink />
                  Video
                </Button>
                <Button variant="ghost" size="sm" onClick={reset}>
                  <RotateCcw />
                  New
                </Button>
              </div>
            </div>

            <div>
              {sections.map((section, index) => (
                <article key={`${section.title}-${index}`} className="border-t border-black/10 py-9 first:border-t-0 first:pt-0 sm:grid sm:grid-cols-[44px_1fr] sm:gap-5">
                  <p className="mb-3 font-mono text-[10px] text-black/35 sm:mb-0 sm:pt-1">
                    {String(index + 1).padStart(2, "0")}
                  </p>
                  <div>
                    <h3 className="mb-5 text-xl font-semibold tracking-[-0.025em]">{section.title}</h3>
                    <div className="summary-markdown min-w-0 overflow-x-auto">
                      <BriefMarkdown content={section.content} onTimecode={playTimecode} />
                    </div>
                  </div>
                </article>
              ))}
            </div>

            <div className="border-t border-black/10 pt-10">
              <h3 className="text-xl font-semibold tracking-[-0.025em]">Ask about this video</h3>
              <p className="mt-2 max-w-xl text-sm leading-6 text-black/50">
                Follow-ups keep this brief in context and answer with the same model that wrote it.
              </p>

              <form onSubmit={askFollowup} className="mt-5 flex flex-col gap-2 sm:flex-row">
                <Label htmlFor="followup-question" className="sr-only">Follow-up question</Label>
                <Input
                  id="followup-question"
                  value={followupInput}
                  disabled={followupState === "running"}
                  onChange={(event) => {
                    setFollowupInput(event.target.value)
                    if (followupState === "error") setFollowupState("idle")
                  }}
                  placeholder="What else do you want to know?"
                  className="h-11 flex-1 rounded-md border-black/20 bg-white px-3.5 shadow-none placeholder:text-black/28 focus-visible:border-black focus-visible:ring-black/10"
                />
                <Button
                  type="submit"
                  disabled={followupState === "running" || !followupInput.trim()}
                  className="h-11 rounded-md bg-black px-5 text-white hover:bg-black/80"
                >
                  {followupState !== "running" && <ArrowRight />}
                  {followupState === "running" ? "Thinking" : "Ask"}
                </Button>
              </form>

              {followups.length > 0 && (
                <div className="mt-10">
                  {followups.map((item, index) => (
                    <article key={`${index}-${item.question}`} className="border-t border-black/8 py-8 first:border-t-0 first:pt-0">
                      <p className="border-l-2 border-black pl-4 text-[0.95rem] font-semibold leading-7 tracking-[-0.01em]">
                        {item.question}
                      </p>
                      <div className="summary-markdown mt-5 min-w-0 overflow-x-auto">
                        <BriefMarkdown content={item.answer} onTimecode={playTimecode} />
                      </div>
                      <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.12em] text-black/35">
                        Answered in {formatElapsed(item.elapsed)}
                      </p>
                    </article>
                  ))}
                </div>
              )}

              {followupState === "running" && (
                <Card size="sm" className="loading-shell mt-6 flex-row py-0" aria-live="polite">
                  <div className="grid size-7 shrink-0 place-items-center rounded-full border border-black/10 bg-white" aria-hidden="true">
                    <img src={providerLogos[resultSettings.provider]} alt="" className="size-3.5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium">Working through your question</p>
                    <p className="mt-0.5 truncate text-[11px] text-black/38">
                      {providerLabels[resultSettings.provider]} · {resultSettings.model} · {resultSettings.reasoning}
                    </p>
                  </div>
                  <div className="loading-rail" aria-hidden="true"><span /></div>
                </Card>
              )}

              {followupState === "error" && (
                <Alert className="mt-6 border-black/10 bg-black/[0.015] text-black/70">
                  <CircleAlert className="size-4" />
                  <AlertDescription className="text-black/65">{followupError}</AlertDescription>
                </Alert>
              )}
            </div>
          </section>
        )}

        {player && videoId && (
          <Card
            ref={playerRef}
            style={playerPosition ? {
              left: playerPosition.left,
              top: playerPosition.top,
              right: "auto",
              bottom: "auto",
            } : undefined}
            className={`video-player fixed z-50 w-[calc(100vw-2rem)] max-w-[420px] gap-0 overflow-hidden rounded-lg border border-white/20 bg-black py-0 shadow-2xl ring-0 ${
              playerPosition ? "transition-none" : `${playerCornerClasses[playerCorner]} transition-[top,right,bottom,left] duration-200`
            }`}
          >
            <div
              data-player-handle
              className={`flex h-9 touch-none select-none items-center justify-between px-3 text-white ${
                isPlayerFullscreen ? "cursor-default" : isPlayerDragging ? "cursor-grabbing" : "cursor-grab"
              }`}
              onPointerDown={startPlayerDrag}
              onPointerMove={movePlayer}
              onPointerUp={finishPlayerDrag}
              onPointerCancel={finishPlayerDrag}
              title={isPlayerFullscreen ? undefined : "Drag to move the video"}
            >
              <span className="font-mono text-[10px] text-white/65">From {player.label}</span>
              <div className="flex items-center gap-1">
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={togglePlayerFullscreen}
                        className="text-white/70 hover:bg-white/10 hover:text-white"
                        aria-label={isPlayerFullscreen ? "Exit full screen" : "Expand video to full screen"}
                      />
                    }
                  >
                    {isPlayerFullscreen
                      ? <Minimize2 className="size-3.5" />
                      : <Maximize2 className="size-3.5" />}
                  </TooltipTrigger>
                  <TooltipContent>{isPlayerFullscreen ? "Exit full screen" : "Full screen"}</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={closePlayer}
                        className="text-white/70 hover:bg-white/10 hover:text-white"
                        aria-label="Close video"
                      />
                    }
                  >
                    <X className="size-4" />
                  </TooltipTrigger>
                  <TooltipContent>Close</TooltipContent>
                </Tooltip>
              </div>
            </div>
            <iframe
              key={`${player.seconds}-${player.nonce}`}
              src={`https://www.youtube-nocookie.com/embed/${videoId}?start=${player.seconds}&autoplay=1&rel=0`}
              title={`YouTube video from ${player.label}`}
              className="aspect-video w-full border-0"
              allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
              allowFullScreen
            />
          </Card>
        )}
      </div>
      </main>
    </TooltipProvider>
  )
}
