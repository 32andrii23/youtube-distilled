import {
  type CSSProperties,
  type FormEvent,
  memo,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import {
  ArrowRight,
  Check,
  ChevronDown,
  CircleAlert,
  Clipboard,
  CopyPlus,
  ExternalLink,
  type LucideIcon,
  Maximize2,
  Minimize2,
  Monitor,
  Moon,
  RotateCcw,
  Sun,
  X,
} from "lucide-react"
import ReactMarkdown, { type Components } from "react-markdown"
import remarkGfm from "remark-gfm"
import { extractVerdict, isVerdictHeading } from "../extension/verdict.js"
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
import { Slider } from "@/components/ui/slider"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import MermaidDiagram from "@/src/MermaidDiagram"
import { nearestPlayerCorner, type PlayerCorner } from "@/src/player-position"
import {
  applyTheme,
  DARK_MEDIA_QUERY,
  loadThemeMode,
  nextThemeMode,
  type ResolvedTheme,
  resolveTheme,
  saveThemeMode,
  systemPrefersDark,
  type ThemeMode,
} from "@/src/theme"
import { linkifyTimecodes } from "@/src/timecodes"

const API_URL = "http://127.0.0.1:4322"
const SETTINGS_KEY = "youtube-distilled-settings"
// Matches the <title> in index.html: what the tab is called before a video names it.
const APP_NAME = "YouTube Distilled"

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

type VideoNameResponse = {
  video_url: string
  title: string | null
  author: string | null
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

const themeIcons: Record<ThemeMode, LucideIcon> = {
  system: Monitor,
  light: Sun,
  dark: Moon,
}

const themeLabels: Record<ThemeMode, string> = {
  system: "System",
  light: "Light",
  dark: "Dark",
}

const fallbackProviders: ProviderCatalog = {
  codex: {
    available: true,
    models: [
      { id: "gpt-5.6-sol", label: "GPT-5.6 Sol", description: "Best quality", reasoning: ["low", "medium", "high", "xhigh", "max"], default_reasoning: "low" },
      { id: "gpt-5.5", label: "GPT-5.5", description: "Strong all-rounder", reasoning: ["low", "medium", "high", "xhigh"], default_reasoning: "medium" },
      { id: "gpt-5.4", label: "GPT-5.4", description: "Balanced", reasoning: ["low", "medium", "high", "xhigh"], default_reasoning: "medium" },
      { id: "gpt-5.6-luna", label: "GPT-5.6 Luna", description: "Fast and cheap", reasoning: ["low", "medium", "high", "xhigh", "max"], default_reasoning: "low" },
      { id: "gpt-5.3-codex-spark", label: "GPT-5.3 Codex Spark", description: "Near-instant", reasoning: ["low", "medium", "high"], default_reasoning: "low" },
      { id: "gpt-5.4-mini", label: "GPT-5.4 Mini", description: "Small and quick", reasoning: ["low", "medium", "high", "xhigh"], default_reasoning: "low" },
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

// The API answers with a JSON detail on failure, but a crashed worker or a
// proxy in the way does not. Parsing before checking the status turns those
// into a parse error instead of something worth reading.
async function readPayload<T>(response: Response, fallback: string): Promise<T> {
  let payload: (T & { detail?: string }) | null = null
  try {
    payload = (await response.json()) as T & { detail?: string }
  } catch {
    payload = null
  }

  if (!response.ok) throw new Error(payload?.detail || fallback)
  if (!payload) throw new Error(fallback)
  return payload
}

const remarkPlugins = [remarkGfm]

// react-markdown renders every node through these components, so a fresh object
// of fresh functions is a fresh set of component types: React would throw the
// rendered brief away and mount it again. That is barely visible for a
// paragraph and very visible for a diagram, which loses its drawing and gets it
// back a frame later. Hence useMemo here and memo below — a keystroke in the
// follow-up box must not disturb the brief above it.
function BriefMarkdownView({
  content,
  onTimecode,
  theme,
}: {
  content: string
  onTimecode: (label: string, seconds: number) => void
  theme: ResolvedTheme
}) {
  const components = useMemo<Components>(() => ({
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
    code: ({ className, children, ...props }) => {
      if (className === "language-mermaid") {
        return (
          <MermaidDiagram
            source={String(children).trimEnd()}
            onTimecode={onTimecode}
            theme={theme}
          />
        )
      }

      return <code className={className} {...props}>{children}</code>
    },
  }), [onTimecode, theme])

  const markdown = useMemo(() => linkifyTimecodes(content), [content])

  return (
    <ReactMarkdown remarkPlugins={remarkPlugins} components={components}>
      {markdown}
    </ReactMarkdown>
  )
}

const BriefMarkdown = memo(BriefMarkdownView)

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
  const [pickerOpen, setPickerOpen] = useState(false)
  const [timingsOpen, setTimingsOpen] = useState(false)
  const [themeMode, setThemeMode] = useState<ThemeMode>(loadThemeMode)
  const [prefersDark, setPrefersDark] = useState(systemPrefersDark)
  const [settings, setSettings] = useState<AppSettings>(loadSettings)
  const [providers, setProviders] = useState<ProviderCatalog>(fallbackProviders)
  const [timings, setTimings] = useState<TimingItem[]>([])
  const [resultSettings, setResultSettings] = useState<AppSettings>(defaultSettings)
  const [followups, setFollowups] = useState<FollowupItem[]>([])
  const [followupInput, setFollowupInput] = useState("")
  const [followupState, setFollowupState] = useState<FollowupState>("idle")
  const [followupError, setFollowupError] = useState("")
  const [videoTitle, setVideoTitle] = useState("")
  const [videoAuthor, setVideoAuthor] = useState("")
  const resultRef = useRef<HTMLDivElement>(null)
  const playerRef = useRef<HTMLDivElement>(null)
  const playerDragOffsetRef = useRef({ x: 0, y: 0 })
  const playerPositionRef = useRef<PlayerPosition | null>(null)
  const playerDraggingRef = useRef(false)
  const verdict = useMemo(() => extractVerdict(summary), [summary])
  // The verdict is rendered as the badge above, so leaving it in the list would
  // print it twice and push every other section's number up by one.
  const sections = useMemo(
    () => splitSummary(summary).filter((section) => !isVerdictHeading(section.title)),
    [summary],
  )
  const videoId = getVideoId(videoUrl)
  const provider = providers[settings.provider]
  const selectedModel = provider.models.find((model) => model.id === settings.model) ?? provider.models[0]
  const loadingStage = [...loadingStages].reverse().find((stage) => elapsed >= stage.after) ?? loadingStages[0]
  const resolvedTheme = resolveTheme(themeMode, prefersDark)
  const nextMode = nextThemeMode(themeMode)
  const ThemeIcon = themeIcons[themeMode]
  const reasoningLevels = selectedModel.reasoning

  useEffect(() => {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
  }, [settings])

  // "System" has to keep tracking the OS, so a theme flip while the tab is open
  // retints it without a reload.
  useEffect(() => {
    const media = window.matchMedia(DARK_MEDIA_QUERY)
    const sync = () => setPrefersDark(media.matches)
    media.addEventListener("change", sync)
    return () => media.removeEventListener("change", sync)
  }, [])

  useEffect(() => {
    applyTheme(resolvedTheme)
    saveThemeMode(themeMode)
  }, [resolvedTheme, themeMode])

  // The tab takes the video's name as soon as a run starts, so several tabs
  // distilling at once are tellable apart from the tab strip alone. The name is
  // YouTube's own — nothing extra is asked of the model.
  useEffect(() => {
    document.title = videoTitle ? `${videoTitle} · ${APP_NAME}` : APP_NAME
  }, [videoTitle])

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

  // Names the tab and heads the finished brief. Fired alongside the run rather
  // than awaited: a slow or failed lookup must not hold up the distilling, and
  // YouTube's own name for the video arrives long before the brief does.
  async function nameVideo(pastedUrl: string) {
    try {
      const response = await fetch(`${API_URL}/api/video?url=${encodeURIComponent(pastedUrl)}`)
      if (!response.ok) return
      const payload = (await response.json()) as VideoNameResponse
      if (payload.title) setVideoTitle(payload.title)
      if (payload.author) setVideoAuthor(payload.author)
    } catch {
      // The tab keeps the app's own name and the brief heads itself "Summary".
      // Nothing else depends on this.
    }
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
    setPickerOpen(false)
    setFollowups([])
    setFollowupInput("")
    setFollowupState("idle")
    setFollowupError("")
    setVideoTitle("")
    setVideoAuthor("")
    nameVideo(trimmedUrl)

    try {
      const response = await fetch(`${API_URL}/api/summarize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: trimmedUrl, ...settings }),
      })
      const payload = await readPayload<SummaryResponse>(response, "The summary could not be generated.")

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
      const payload = await readPayload<FollowupResponse>(response, "The answer could not be generated.")

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
    setVideoTitle("")
    setVideoAuthor("")
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

  // The app keeps nothing in the URL, so the same address opens on the empty
  // state: a second video can be distilled beside the first without disturbing
  // the run in this tab. The local service takes several at once.
  function openAnotherTab() {
    window.open(`${window.location.origin}${window.location.pathname}`, "_blank", "noopener")
  }

  // Stable, or the brief's memoised markdown would be rebuilt on every render
  // that this function outlived — which is all of them.
  const playTimecode = useCallback((label: string, seconds: number) => {
    setPlayer({ label, seconds, nonce: Date.now() })
  }, [])

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
      <main className="min-h-screen bg-background text-foreground selection:bg-primary selection:text-primary-foreground">
        <div className="fixed top-4 right-4 z-50 flex items-center gap-2">
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="outline"
                size="icon-lg"
                onClick={openAnotherTab}
                className="rounded-full bg-card text-foreground/55 shadow-sm hover:text-foreground"
                aria-label="Open another YouTube Distilled tab, ready for a second video."
              />
            }
          >
            <CopyPlus />
          </TooltipTrigger>
          <TooltipContent>Another tab</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="outline"
                size="icon-lg"
                onClick={() => setThemeMode(nextMode)}
                className="rounded-full bg-card text-foreground/55 shadow-sm hover:text-foreground"
                aria-label={`Theme: ${themeLabels[themeMode].toLowerCase()}. Switch to ${themeLabels[nextMode].toLowerCase()}.`}
              />
            }
          >
            <ThemeIcon />
          </TooltipTrigger>
          <TooltipContent>Theme: {themeLabels[themeMode]}</TooltipContent>
        </Tooltip>

        <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
          <PopoverTrigger
            render={
              <Button
                variant="outline"
                size="icon-lg"
                className="rounded-full bg-card shadow-sm"
                aria-label={`Choose model. Currently ${providerLabels[settings.provider]} ${selectedModel.label}.`}
              />
            }
          >
            {/* The active provider's mark, so the trigger says which model is armed. */}
            <img
              src={providerLogos[settings.provider]}
              alt=""
              className="size-4 dark:invert"
              aria-hidden="true"
            />
          </PopoverTrigger>
          <PopoverContent
            align="end"
            sideOffset={8}
            className="w-[calc(100vw-2rem)] max-w-[320px] gap-0 p-4 shadow-[0_16px_50px_rgba(0,0,0,0.12)]"
          >
            <PopoverHeader className="mb-4">
              <PopoverTitle className="font-semibold">Model</PopoverTitle>
            </PopoverHeader>

            <Label className="mb-2 text-[10px] uppercase tracking-[0.12em] text-foreground/40">
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
                  // The marks are black artwork: they need inverting whenever they
                  // sit on a dark ground, which is the pressed segment in light
                  // mode and everything but the pressed segment in dark mode.
                  className="h-10 w-full gap-2 rounded-none border-foreground/10 text-xs text-foreground/50 first:rounded-l-lg last:rounded-r-lg aria-pressed:bg-primary aria-pressed:text-primary-foreground aria-pressed:[&_img]:invert dark:[&_img]:invert dark:aria-pressed:[&_img]:invert-0"
                  aria-label={`Use ${providerLabels[providerId]}`}
                >
                  <img src={providerLogos[providerId]} alt="" className="size-4" aria-hidden="true" />
                  {providerLabels[providerId]}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>

            <div className="mt-5 space-y-4">
              <div className="space-y-2">
                <Label className="text-[10px] uppercase tracking-[0.12em] text-foreground/40" htmlFor="model-setting">
                  Model
                </Label>
                <Select
                  value={selectedModel.id}
                  disabled={state === "running"}
                  onValueChange={(value) => value && changeModel(value)}
                >
                  <SelectTrigger id="model-setting" className="h-10 w-full border-foreground/15">
                    <SelectValue>{selectedModel.label}</SelectValue>
                  </SelectTrigger>
                  <SelectContent align="end">
                    {provider.models.map((model) => (
                      <SelectItem key={model.id} value={model.id}>
                        <span>{model.label}</span>
                        <span className="text-xs text-foreground/40">{model.description}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                {/* A plain paragraph, not a Label: the slider carries its own
                    aria-label, so a <label> here would point at nothing. */}
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-[10px] uppercase tracking-[0.12em] text-foreground/40">
                    Reasoning
                  </p>
                  <span className="font-mono text-[11px] text-foreground/65 capitalize">
                    {settings.reasoning}
                  </span>
                </div>
                {reasoningLevels.length > 1 ? (
                  <Slider
                    ticks={reasoningLevels.length}
                    min={0}
                    max={reasoningLevels.length - 1}
                    step={1}
                    value={Math.max(0, reasoningLevels.indexOf(settings.reasoning))}
                    disabled={state === "running"}
                    onValueChange={(value) => {
                      const level = reasoningLevels[value]
                      if (level) setSettings((current) => ({ ...current, reasoning: level }))
                    }}
                    aria-label="Reasoning effort"
                    className="py-2"
                  />
                ) : (
                  // A one-stop slider is a dead control, so the sole level says so.
                  <p className="text-[11px] leading-4 text-foreground/38">
                    {selectedModel.label} runs at a single reasoning level.
                  </p>
                )}
              </div>
            </div>

            <PopoverDescription className="mt-4 text-[11px] leading-4 text-foreground/38">
              Lower reasoning is faster. Each provider uses its existing local CLI login.
            </PopoverDescription>
          </PopoverContent>
        </Popover>
        </div>

      <div className="mx-auto w-full max-w-3xl px-5 sm:px-8">
        <section className="py-24 sm:py-32">
          <div className="flex items-center gap-3 sm:gap-4">
            {/* The file is an opaque near-white box, not transparent artwork, so
                without this it paints a bright square on the dark page. */}
            <img src="/logo.png" alt="" className="size-12 shrink-0 dark:invert sm:size-14" aria-hidden="true" />
            <h1 className="text-5xl font-semibold tracking-[-0.055em] sm:text-6xl">YouTube Distilled.</h1>
          </div>
          <p className="mt-5 max-w-xl text-base leading-7 text-foreground/55">
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
              className="h-11 flex-1 rounded-md border-foreground/20 bg-card px-3.5 shadow-none placeholder:text-foreground/28 focus-visible:border-foreground focus-visible:ring-foreground/10"
            />
            <Button
              type="submit"
              disabled={state === "running" || !url.trim() || !provider.available}
              className="h-11 rounded-md bg-primary px-5 text-primary-foreground hover:bg-primary/85"
            >
              {state !== "running" && <ArrowRight />}
              {state === "running" ? "Distilling" : "Summarize"}
            </Button>
          </form>

          {state === "running" && (
            <Card size="sm" className="loading-shell mt-5 flex-row py-0" aria-live="polite">
              <div className="grid size-8 shrink-0 place-items-center rounded-full border border-foreground/10 bg-card" aria-hidden="true">
                <img src={providerLogos[settings.provider]} alt="" className="size-4 dark:invert" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{loadingStage.label}</p>
                <p className="mt-1 truncate text-[11px] text-foreground/38">
                  {providerLabels[settings.provider]} · {selectedModel.label} · {settings.reasoning}
                </p>
              </div>
              <time className="font-mono text-xs tabular-nums text-foreground/48">{formatElapsed(elapsed)}</time>
              <div className="loading-rail" aria-hidden="true"><span /></div>
            </Card>
          )}

          {state === "error" && (
            <Alert className="mt-4 border-foreground/10 bg-foreground/[0.015] text-foreground/70">
              <CircleAlert className="size-4" />
              <AlertDescription className="text-foreground/65">{error}</AlertDescription>
            </Alert>
          )}
        </section>

        {state === "success" && (
          <section ref={resultRef} className="scroll-mt-4 py-14 sm:py-16">
            <Separator className="mb-14 bg-foreground/10 sm:mb-16" />
            <div className="mb-10 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <Collapsible open={timingsOpen} onOpenChange={setTimingsOpen}>
                  <CollapsibleTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="xs"
                        className="-ml-2 h-6 gap-1.5 px-2 font-mono text-[10px] uppercase tracking-[0.12em] text-foreground/40 hover:text-foreground/65"
                      />
                    }
                  >
                    Ready in {formatElapsed(completedIn)}
                    <ChevronDown className={`size-3 transition-transform ${timingsOpen ? "rotate-180" : ""}`} />
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <Card size="sm" className="mt-3 w-72 bg-foreground/[0.03] py-3 shadow-none">
                      <CardContent className="px-3">
                        {timings.map((timing) => (
                          <div key={timing.label} className="flex items-center justify-between py-1 text-[11px] text-foreground/50">
                            <span>{timing.label}</span>
                            <span className="font-mono tabular-nums text-foreground/65">{formatStepDuration(timing.seconds)}</span>
                          </div>
                        ))}
                        <Separator className="my-2 bg-foreground/8" />
                        <p className="text-[10px] text-foreground/35">
                          {providerLabels[resultSettings.provider]} · {resultSettings.model} · {resultSettings.reasoning}
                        </p>
                      </CardContent>
                    </Card>
                  </CollapsibleContent>
                </Collapsible>
                {/* The video's own name, so a brief read hours later — or in one
                    of several open tabs — says what it is about before it says
                    anything else. The lookup can fail or still be in flight, and
                    then the section falls back to naming itself. */}
                <h2 className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-balance">
                  {videoTitle || "Summary"}
                </h2>
                {videoAuthor && (
                  <p className="mt-2 text-sm text-foreground/45">{videoAuthor}</p>
                )}
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

            {/* The call, before the brief that argues for it. The number is
                the whole point of the block: a glance at it decides whether the
                nine sections below are worth opening at all. */}
            {verdict && (
              <div
                className="mb-10 flex items-start gap-4 rounded-xl border border-foreground/10 p-4 sm:items-center sm:gap-5 sm:p-5"
                style={{ "--verdict": `var(--verdict-${verdict.tone})` } as CSSProperties}
              >
                <div
                  className="flex size-14 shrink-0 flex-col items-center justify-center gap-0.5 rounded-lg"
                  style={{
                    background: "color-mix(in oklab, var(--verdict) 12%, transparent)",
                    boxShadow: "inset 0 0 0 1px color-mix(in oklab, var(--verdict) 32%, transparent)",
                  }}
                >
                  <span
                    className="font-mono text-xl font-semibold leading-none tabular-nums"
                    style={{ color: "var(--verdict)" }}
                  >
                    {verdict.score}
                  </span>
                  <span className="font-mono text-[9px] leading-none text-foreground/35">/100</span>
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold tracking-[-0.01em]" style={{ color: "var(--verdict)" }}>
                    {verdict.label}
                    <span className="font-normal text-foreground/40"> · {verdict.note}</span>
                  </p>
                  {verdict.reason && (
                    <p className="mt-1.5 text-sm leading-6 text-foreground/70">{verdict.reason}</p>
                  )}
                </div>
              </div>
            )}

            <div>
              {sections.map((section, index) => (
                <article key={`${section.title}-${index}`} className="border-t border-foreground/10 py-9 first:border-t-0 first:pt-0 sm:grid sm:grid-cols-[44px_1fr] sm:gap-5">
                  <p className="mb-3 font-mono text-[10px] text-foreground/35 sm:mb-0 sm:pt-1">
                    {String(index + 1).padStart(2, "0")}
                  </p>
                  <div>
                    <h3 className="mb-5 text-xl font-semibold tracking-[-0.025em]">{section.title}</h3>
                    <div className="summary-markdown min-w-0 overflow-x-auto">
                      <BriefMarkdown content={section.content} onTimecode={playTimecode} theme={resolvedTheme} />
                    </div>
                  </div>
                </article>
              ))}
            </div>

            <div className="border-t border-foreground/10 pt-10">
              <h3 className="text-xl font-semibold tracking-[-0.025em]">Ask about this video</h3>
              <p className="mt-2 max-w-xl text-sm leading-6 text-foreground/50">
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
                  className="h-11 flex-1 rounded-md border-foreground/20 bg-card px-3.5 shadow-none placeholder:text-foreground/28 focus-visible:border-foreground focus-visible:ring-foreground/10"
                />
                <Button
                  type="submit"
                  disabled={followupState === "running" || !followupInput.trim()}
                  className="h-11 rounded-md bg-primary px-5 text-primary-foreground hover:bg-primary/85"
                >
                  {followupState !== "running" && <ArrowRight />}
                  {followupState === "running" ? "Thinking" : "Ask"}
                </Button>
              </form>

              {followups.length > 0 && (
                <div className="mt-10">
                  {followups.map((item, index) => (
                    <article key={`${index}-${item.question}`} className="border-t border-foreground/8 py-8 first:border-t-0 first:pt-0">
                      <p className="border-l-2 border-foreground pl-4 text-[0.95rem] font-semibold leading-7 tracking-[-0.01em]">
                        {item.question}
                      </p>
                      <div className="summary-markdown mt-5 min-w-0 overflow-x-auto">
                        <BriefMarkdown content={item.answer} onTimecode={playTimecode} theme={resolvedTheme} />
                      </div>
                      <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.12em] text-foreground/35">
                        Answered in {formatElapsed(item.elapsed)}
                      </p>
                    </article>
                  ))}
                </div>
              )}

              {followupState === "running" && (
                <Card size="sm" className="loading-shell mt-6 flex-row py-0" aria-live="polite">
                  <div className="grid size-7 shrink-0 place-items-center rounded-full border border-foreground/10 bg-card" aria-hidden="true">
                    <img src={providerLogos[resultSettings.provider]} alt="" className="size-3.5 dark:invert" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium">Working through your question</p>
                    <p className="mt-0.5 truncate text-[11px] text-foreground/38">
                      {providerLabels[resultSettings.provider]} · {resultSettings.model} · {resultSettings.reasoning}
                    </p>
                  </div>
                  <div className="loading-rail" aria-hidden="true"><span /></div>
                </Card>
              )}

              {followupState === "error" && (
                <Alert className="mt-6 border-foreground/10 bg-foreground/[0.015] text-foreground/70">
                  <CircleAlert className="size-4" />
                  <AlertDescription className="text-foreground/65">{followupError}</AlertDescription>
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
