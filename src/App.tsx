import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import {
  ArrowRightIcon,
  ChatBubbleIcon,
  CheckIcon,
  ClipboardCopyIcon,
  ClockIcon,
  Crosshair2Icon,
  DotsHorizontalIcon,
  ListBulletIcon,
  MagnifyingGlassIcon,
  PaperPlaneIcon,
  Pencil2Icon,
  PersonIcon
} from "@radix-ui/react-icons"
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react"

type Panel = "summary" | "transcript" | "chat"
type Message = { role: "user" | "assistant"; text: string }
type TranscriptSegment = {
  start: number
  end: number
  speaker: string
  text: string
}
type VideoItem = {
  id: string
  url: string
  title: string
  transcript: string
  transcriptSegments?: TranscriptSegment[]
  summary: string
  transcriptStatus: string
  messages: Message[]
}
type Provider = {
  id: string
  name: string
  models: string[]
  canChat: boolean
  canTranscribe: boolean
}

declare global {
  interface Window {
    YT?: {
      Player: new (
        element: HTMLIFrameElement,
        options: {
          events: {
            onReady: (event: { target: YouTubePlayer }) => void
            onStateChange: (event: { data: number }) => void
          }
        }
      ) => YouTubePlayer
    }
    onYouTubeIframeAPIReady?: () => void
  }
}

type YouTubePlayer = {
  destroy?: () => void
  getCurrentTime?: () => number
  getDuration?: () => number
  getPlayerState?: () => number
  seekTo?: (seconds: number, allowSeekAhead: boolean) => void
}

let youtubeApiPromise: Promise<Window["YT"]> | null = null

function loadYouTubeApi() {
  if (window.YT?.Player) return Promise.resolve(window.YT)
  if (youtubeApiPromise) return youtubeApiPromise

  youtubeApiPromise = new Promise((resolve) => {
    const previousReady = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => {
      previousReady?.()
      resolve(window.YT)
    }
    const script = document.createElement("script")
    script.src = "https://www.youtube.com/iframe_api"
    document.body.appendChild(script)
  })

  return youtubeApiPromise
}

const providers: Provider[] = [
  {
    id: "deepgram",
    name: "Deepgram",
    models: ["nova-3", "nova-2", "whisper"],
    canChat: false,
    canTranscribe: true
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    models: [
      "openai/gpt-4o-mini",
      "anthropic/claude-3.5-sonnet",
      "google/gemini-flash-1.5",
      "meta-llama/llama-3.1-70b-instruct"
    ],
    canChat: true,
    canTranscribe: true
  },
  {
    id: "openai",
    name: "OpenAI",
    models: ["gpt-4o-mini", "gpt-4o", "gpt-4-turbo"],
    canChat: true,
    canTranscribe: true
  },
  {
    id: "anthropic",
    name: "Anthropic",
    models: ["claude-3-5-sonnet", "claude-3-opus", "claude-3-haiku"],
    canChat: false,
    canTranscribe: false
  },
  {
    id: "google",
    name: "Google",
    models: ["gemini-1.5-pro", "gemini-1.5-flash"],
    canChat: false,
    canTranscribe: false
  },
  {
    id: "groq",
    name: "Groq",
    models: ["llama-3.1-70b-versatile", "mixtral-8x7b-32768"],
    canChat: false,
    canTranscribe: false
  }
]

const examples = [
  "Какие главные идеи есть в видео?",
  "Выдели самые важные части видео",
  "Какие основные выводы из видео?"
]

function readLocal<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key)
    return value ? JSON.parse(value) : fallback
  } catch {
    return fallback
  }
}

function getYouTubeId(value: string) {
  try {
    const url = new URL(value)
    if (url.hostname.includes("youtu.be")) return url.pathname.slice(1).split("/")[0]
    if (url.pathname.startsWith("/shorts/")) return url.pathname.split("/")[2]
    return url.searchParams.get("v")
  } catch {
    return null
  }
}

function formatTime(seconds: number) {
  return new Date(seconds * 1000).toISOString().slice(14, 19)
}

function transcriptLines(value: string) {
  return value
    .split(/(?<=[.!?…])\s+|\n+/)
    .map((text) => text.trim())
    .filter(Boolean)
}

function speakerLine(text: string) {
  const match = text.match(/^([^:]{2,32}):\s*(.+)$/)
  return {
    speaker: match ? match[1] : "Автор",
    text: match ? match[2] : text
  }
}

function isTranscriptSegment(
  segment: TranscriptSegment | null
): segment is TranscriptSegment {
  return Boolean(segment)
}

function normalizeSegment(segment: Partial<TranscriptSegment> | null | undefined) {
  if (!segment || typeof segment !== "object") return null
  const start = Number(segment.start)
  const end = Number(segment.end)
  const text = String(segment.text || "").trim()
  if (!Number.isFinite(start) || !text) return null
  return {
    start,
    end: Number.isFinite(end) && end > start ? end : start + 0.5,
    speaker: segment.speaker || "Спикер 1",
    text
  }
}

export default function App() {
  const [panel, setPanel] = useState<Panel>(readLocal("scribeowl.panel", "chat"))
  const [page, setPage] = useState<"player" | "profile">(
    readLocal("scribeowl.page", "player")
  )
  const [url, setUrl] = useState("")
  const [playlist, setPlaylist] = useState<VideoItem[]>(
    readLocal("scribeowl.playlist", [])
  )
  const [activeId, setActiveId] = useState<string>(readLocal("scribeowl.activeId", ""))
  const [openMenuId, setOpenMenuId] = useState("")
  const [prompt, setPrompt] = useState("")
  const [transcriptQuery, setTranscriptQuery] = useState("")
  const [copiedTranscript, setCopiedTranscript] = useState(false)
  const [busy, setBusy] = useState<"" | "transcript" | "summary" | "chat">("")
  const [hiddenToasts, setHiddenToasts] = useState<Record<string, boolean>>(
    readLocal("scribeowl.hiddenToasts", {})
  )
  const [providerId, setProviderId] = useState(
    readLocal("scribeowl.providerId", "openrouter")
  )
  const provider = providers.find((item) => item.id === providerId) || providers[0]
  const [model, setModel] = useState(readLocal("scribeowl.model", provider.models[0]))
  const [apiKey, setApiKey] = useState(readLocal("scribeowl.apiKey", ""))
  const [saved, setSaved] = useState(false)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const youtubePlayerRef = useRef<YouTubePlayer | null>(null)
  const [playerTime, setPlayerTime] = useState(0)
  const [videoDuration, setVideoDuration] = useState(0)

  const activeVideo = playlist.find((item) => item.id === activeId) || null
  const toastKey = activeVideo ? `${activeVideo.id}:${activeVideo.transcriptStatus}` : ""
  const showToast = Boolean(activeVideo?.transcriptStatus && !hiddenToasts[toastKey])
  const embedUrl = activeVideo
    ? `https://www.youtube.com/embed/${activeVideo.id}?autoplay=0&rel=0&enablejsapi=1&origin=${encodeURIComponent(window.location.origin)}`
    : ""
  const lines = useMemo(() => {
    const storedSegments = activeVideo?.transcriptSegments
      ?.map(normalizeSegment)
      .filter(isTranscriptSegment)
    if (storedSegments?.length) return storedSegments

    const items = transcriptLines(activeVideo?.transcript || "")
    const step = videoDuration && items.length ? videoDuration / items.length : 30
    return items.map((line, index) => ({
      ...speakerLine(line),
      start: index * step,
      end: (index + 1) * step
    }))
  }, [activeVideo?.transcript, videoDuration])
  const activeLine = lines.findIndex(
    (line, index) =>
      line &&
      playerTime >= line.start &&
      playerTime <
        (lines.slice(index + 1).find(isTranscriptSegment)?.start ??
          Math.max(line.end, line.start + 0.5))
  )
  const filteredLines = lines
    .map((line, index) => ({ line, index }))
    .filter(
      ({ line }) =>
        isTranscriptSegment(line) &&
        line.text.toLowerCase().includes(transcriptQuery.trim().toLowerCase())
    )

  useEffect(
    () => localStorage.setItem("scribeowl.playlist", JSON.stringify(playlist)),
    [playlist]
  )
  useEffect(
    () => localStorage.setItem("scribeowl.activeId", JSON.stringify(activeId)),
    [activeId]
  )
  useEffect(() => localStorage.setItem("scribeowl.panel", JSON.stringify(panel)), [panel])
  useEffect(() => localStorage.setItem("scribeowl.page", JSON.stringify(page)), [page])
  useEffect(
    () => localStorage.setItem("scribeowl.providerId", JSON.stringify(providerId)),
    [providerId]
  )
  useEffect(() => localStorage.setItem("scribeowl.model", JSON.stringify(model)), [model])
  useEffect(
    () => localStorage.setItem("scribeowl.apiKey", JSON.stringify(apiKey)),
    [apiKey]
  )
  useEffect(
    () => localStorage.setItem("scribeowl.hiddenToasts", JSON.stringify(hiddenToasts)),
    [hiddenToasts]
  )

  useEffect(() => {
    playlist
      .filter((item) => item.title.startsWith("YouTube-видео:"))
      .forEach((item) => {
        fetchTitle(item.url).then((title) => title && patchVideo(item.id, { title }))
      })
  }, [playlist])

  useEffect(() => {
    setPlayerTime(0)
    setVideoDuration(0)
    youtubePlayerRef.current?.destroy?.()
    youtubePlayerRef.current = null
  }, [activeId])

  useEffect(() => {
    const timer = window.setInterval(() => {
      const player = youtubePlayerRef.current
      if (!player?.getCurrentTime) return
      try {
        setPlayerTime(player.getCurrentTime())
        const duration = player.getDuration?.()
        if (typeof duration === "number" && Number.isFinite(duration)) {
          setVideoDuration(duration)
        }
      } catch {
        return
      }
    }, 250)

    return () => {
      window.clearInterval(timer)
    }
  }, [activeId])

  useEffect(() => {
    document
      .querySelector('[data-active-transcript="true"]')
      ?.scrollIntoView({ block: "nearest" })
  }, [activeLine, panel])

  function patchVideo(id: string, patch: Partial<VideoItem>) {
    setPlaylist((items) =>
      items.map((item) => (item.id === id ? { ...item, ...patch } : item))
    )
  }

  function playerCommand(func: string, args: unknown[] = []) {
    const player = youtubePlayerRef.current
    if (func === "seekTo" && player?.seekTo) {
      const seconds = Number(args[0])
      if (Number.isFinite(seconds)) {
        player.seekTo(seconds, true)
        setPlayerTime(seconds)
        return
      }
    }

    iframeRef.current?.contentWindow?.postMessage(
      JSON.stringify({ event: "command", func, args }),
      "*"
    )
  }

  function onPlayerLoad() {
    const iframe = iframeRef.current
    if (!iframe) return

    loadYouTubeApi().then((YT) => {
      if (!YT?.Player || iframeRef.current !== iframe) return
      youtubePlayerRef.current?.destroy?.()
      youtubePlayerRef.current = new YT.Player(iframe, {
        events: {
          onReady: (event) => {
            setPlayerTime(event.target.getCurrentTime?.() || 0)
            setVideoDuration(event.target.getDuration?.() || 0)
          },
          onStateChange: () => {
            setPlayerTime(youtubePlayerRef.current?.getCurrentTime?.() || 0)
          }
        }
      })
    })
  }

  function focusCurrentTranscript() {
    setPanel("transcript")
    window.requestAnimationFrame(() => {
      document
        .querySelector('[data-active-transcript="true"]')
        ?.scrollIntoView({ block: "center" })
    })
  }

  async function copyTranscript() {
    if (!lines.length) return
    const text = lines
      .filter(isTranscriptSegment)
      .map(
        (line) =>
          `[${formatTime(line.start)} - ${formatTime(line.end)}] ${line.speaker}: ${line.text}`
      )
      .join("\n")
    try {
      await navigator.clipboard.writeText(text)
      setCopiedTranscript(true)
      window.setTimeout(() => setCopiedTranscript(false), 1400)
    } catch {
      setCopiedTranscript(false)
    }
  }

  async function fetchTitle(videoUrl: string) {
    try {
      const response = await fetch(`/api/video?url=${encodeURIComponent(videoUrl)}`)
      const data = await response.json()
      return data.title || ""
    } catch {
      return ""
    }
  }

  async function loadUrl(event: FormEvent) {
    event.preventDefault()
    const id = getYouTubeId(url)
    if (!id) return
    const title = await fetchTitle(url)
    const next: VideoItem = {
      id,
      url,
      title: title || `YouTube-видео: ${id}`,
      transcript: "",
      transcriptSegments: [],
      summary: "",
      transcriptStatus: "Видео добавлено. Запустите AI-транскрипцию.",
      messages: []
    }
    setPlaylist((items) => [next, ...items.filter((item) => item.id !== id)])
    setActiveId(id)
    setPanel("transcript")
    setUrl("")
  }

  async function generateTranscript(video = activeVideo) {
    if (!video || busy) return
    setActiveId(video.id)
    setPanel("transcript")
    if (!provider.canTranscribe) {
      patchVideo(video.id, {
        transcriptStatus: "AI-транскрипция доступна через Deepgram, OpenRouter и OpenAI."
      })
      return
    }
    if (!apiKey.trim()) {
      patchVideo(video.id, {
        transcriptStatus: `Добавьте API-ключ ${provider.name} в профиле.`
      })
      return
    }
    setBusy("transcript")
    patchVideo(video.id, {
      transcriptStatus: `AI распознаёт аудио через ${provider.name}...`
    })
    try {
      const response = await fetch("/api/transcribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ providerId, model, apiKey, id: video.id, url: video.url })
      })
      const data = await response.json()
      patchVideo(video.id, {
        transcript: data.transcript || "",
        transcriptSegments: data.segments || [],
        transcriptStatus:
          data.transcript || data.segments?.length
            ? "AI-транскрипт готов."
            : data.error || "AI-транскрипция не выполнена."
      })
    } catch (error) {
      patchVideo(video.id, {
        transcriptStatus:
          error instanceof Error ? error.message : "AI-транскрипция не выполнена."
      })
    } finally {
      setBusy("")
    }
  }

  async function askAi(question: string) {
    if (!activeVideo) return "Сначала добавьте видео."
    if (!provider.canChat)
      return "Для саммари и чата сейчас выберите OpenRouter или OpenAI в профиле."
    if (!apiKey.trim()) return `Добавьте API-ключ ${provider.name} в профиле.`
    if (!activeVideo.transcript.trim()) return "Сначала сгенерируйте AI-транскрипт."

    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        providerId,
        model,
        apiKey,
        title: activeVideo.title,
        transcript: activeVideo.transcript.slice(0, 20000),
        question
      })
    })
    const data = await response.json()
    return data.answer || data.error || "AI-запрос не выполнен"
  }

  async function ask(event: FormEvent) {
    event.preventDefault()
    const text = prompt.trim()
    if (!activeVideo || !text || busy) return
    patchVideo(activeVideo.id, {
      messages: [...activeVideo.messages, { role: "user", text }]
    })
    setPrompt("")
    setBusy("chat")
    const answer = await askAi(text)
    patchVideo(activeVideo.id, {
      messages: [
        ...activeVideo.messages,
        { role: "user", text },
        { role: "assistant", text: answer }
      ]
    })
    setBusy("")
  }

  async function generateSummary() {
    if (!activeVideo || busy) return
    setBusy("summary")
    const answer = await askAi(
      "Сделай короткое структурированное саммари видео на русском: главная идея, 5 ключевых тезисов, практический вывод."
    )
    patchVideo(activeVideo.id, { summary: answer })
    setBusy("")
  }

  function changeProvider(nextProviderId: string) {
    const nextProvider =
      providers.find((item) => item.id === nextProviderId) || providers[0]
    setProviderId(nextProvider.id)
    setModel(nextProvider.models[0])
  }

  function saveProfile() {
    localStorage.setItem("scribeowl.providerId", JSON.stringify(providerId))
    localStorage.setItem("scribeowl.model", JSON.stringify(model))
    localStorage.setItem("scribeowl.apiKey", JSON.stringify(apiKey))
    setSaved(true)
    window.setTimeout(() => setSaved(false), 1600)
  }

  return (
    <main className="min-h-screen overflow-x-hidden bg-background text-foreground">
      <section className="container py-10">
        <header className="mb-6 flex flex-col gap-4 px-5 py-4 md:flex-row md:items-center md:justify-between">
          <button
            type="button"
            className="font-semibold"
            onClick={() => setPage("player")}>
            Scribeowl AI
          </button>
          <Button
            type="button"
            variant={page === "profile" ? "default" : "outline"}
            className="gap-2"
            onClick={() => setPage("profile")}>
            <PersonIcon />
            Профиль
          </Button>
        </header>

        {page === "profile" ? (
          <ProfilePage
            apiKey={apiKey}
            model={model}
            provider={provider}
            providerId={providerId}
            saved={saved}
            onApiKey={setApiKey}
            onModel={setModel}
            onProvider={changeProvider}
            onSave={saveProfile}
            onBack={() => setPage("player")}
          />
        ) : (
          <Card>
            <CardContent className="grid gap-4 p-6 lg:grid-cols-[minmax(0,1fr)_minmax(360px,460px)]">
              <section className="min-w-0 overflow-hidden">
                <div className="overflow-hidden rounded-md border bg-muted">
                  {activeVideo ? (
                    <iframe
                      key={activeVideo.id}
                      id={`youtube-player-${activeVideo.id}`}
                      ref={iframeRef}
                      title={activeVideo.title}
                      src={embedUrl}
                      onLoad={onPlayerLoad}
                      className="aspect-video h-full min-h-[360px] w-full"
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                      allowFullScreen
                    />
                  ) : (
                    <div className="flex aspect-video min-h-[360px] items-center justify-center px-8 text-center text-muted-foreground">
                      <div>
                        <p className="text-xl font-semibold text-foreground">
                          Добавьте первое YouTube-видео
                        </p>
                        <p className="mt-3 text-sm">
                          Плеер и плейлист появятся после загрузки ссылки.
                        </p>
                      </div>
                    </div>
                  )}
                </div>

                <div className="mt-5">
                  <h1 className="text-lg font-bold leading-snug">
                    {activeVideo?.title || "Плеер пуст"}
                  </h1>
                </div>

                <form onSubmit={loadUrl} className="mt-5 flex gap-2">
                  <Input
                    value={url}
                    onChange={(event) => setUrl(event.target.value)}
                    placeholder="Вставьте ссылку на YouTube"
                    className="h-11"
                  />
                  <Button className="h-11">Загрузить видео</Button>
                </form>

                {playlist.length > 0 && (
                  <section className="mt-5 w-full overflow-hidden rounded-lg border bg-muted p-4">
                    <h2 className="mb-3 text-sm font-semibold">Плейлист</h2>
                    <div className="grid gap-2">
                      {playlist.map((item) => (
                        <div
                          key={item.id}
                          className={cn(
                            "relative grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-md border bg-card p-3 text-sm",
                            item.id === activeId
                              ? "border-primary ring-1 ring-primary"
                              : "border-border"
                          )}>
                          <button
                            type="button"
                            className="min-w-0 text-left"
                            onClick={() => setActiveId(item.id)}>
                            <span className="flex min-w-0 items-center gap-3">
                              <span className="min-w-0 flex-1 truncate font-medium">
                                {item.title}
                              </span>
                              {item.transcript ? (
                                <span className="shrink-0 rounded-md bg-secondary px-2 py-1 text-xs font-medium text-secondary-foreground">
                                  Транскрибировано
                                </span>
                              ) : null}
                            </span>
                            {!item.transcript ? (
                              <span className="mt-1 block truncate text-xs text-muted-foreground">
                                {item.transcriptStatus}
                              </span>
                            ) : null}
                          </button>
                          <button
                            type="button"
                            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md hover:bg-muted"
                            onClick={(event) => {
                              event.stopPropagation()
                              setOpenMenuId(openMenuId === item.id ? "" : item.id)
                            }}>
                            <DotsHorizontalIcon />
                          </button>
                          {openMenuId === item.id ? (
                            <div className="absolute right-3 top-12 z-20 w-[min(16rem,calc(100%-1.5rem))] rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
                              <button
                                type="button"
                                className="w-full rounded-sm px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground"
                                disabled={Boolean(busy)}
                                onClick={() => {
                                  setOpenMenuId("")
                                  generateTranscript(item)
                                }}>
                                {item.transcript
                                  ? "Перегенерировать AI-транскрипт"
                                  : "Сгенерировать AI-транскрипт"}
                              </button>
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </section>
                )}
              </section>

              <aside className="min-w-0 overflow-hidden rounded-lg border bg-card lg:h-[calc(100vh-10rem)] lg:min-h-[520px] lg:max-h-[760px]">
                <Tabs
                  value={panel}
                  onValueChange={(value) => setPanel(value as Panel)}
                  className="grid h-full grid-rows-[auto_1fr]">
                  <div className="border-b p-3">
                    <TabsList className="grid w-full grid-cols-3">
                      <TabsTrigger value="summary" className="gap-2">
                        <Pencil2Icon className="h-4 w-4 opacity-60" />
                        Саммари
                      </TabsTrigger>
                      <TabsTrigger value="transcript" className="gap-2">
                        <ListBulletIcon className="h-4 w-4 opacity-60" />
                        Транскрипт
                      </TabsTrigger>
                      <TabsTrigger value="chat" className="gap-2">
                        <ChatBubbleIcon className="h-4 w-4 opacity-60" />
                        Чат
                      </TabsTrigger>
                    </TabsList>
                  </div>

                  <div
                    className={cn(
                      "grid overflow-hidden",
                      panel === "chat" ? "grid-rows-[1fr_auto]" : "grid-rows-1"
                    )}>
                    <ScrollArea
                      className={cn(
                        "min-h-0 px-3 py-3",
                        panel === "transcript" && "h-full"
                      )}>
                      {!activeVideo && <EmptyState />}

                      {activeVideo &&
                        panel === "chat" &&
                        activeVideo.messages.length === 0 && (
                          <div className="mx-auto flex max-w-[360px] flex-col items-center pt-7 text-center">
                            <h2 className="text-2xl font-medium">YouTube AI</h2>
                            <p className="mt-8 leading-7 text-muted-foreground">
                              Задавайте вопросы только после AI-транскрипции видео.
                            </p>
                            <p className="mt-8 text-muted-foreground">
                              Попробуйте пример:
                            </p>
                            <div className="mt-8 grid w-full gap-4">
                              {examples.map((example) => (
                                <Button
                                  key={example}
                                  type="button"
                                  variant="outline"
                                  className="h-auto justify-start gap-3 whitespace-normal p-4 text-left"
                                  onClick={() => setPrompt(example)}>
                                  <ArrowRightIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                                  {example}
                                </Button>
                              ))}
                            </div>
                          </div>
                        )}

                      {activeVideo &&
                        panel === "chat" &&
                        activeVideo.messages.length > 0 && (
                          <div className="grid gap-3">
                            {activeVideo.messages.map((message, index) => (
                              <div
                                key={index}
                                className={cn(
                                  "max-w-[85%] rounded-md border p-3 text-sm leading-6",
                                  message.role === "user"
                                    ? "ml-auto bg-primary text-primary-foreground"
                                    : "bg-muted"
                                )}>
                                {message.text}
                              </div>
                            ))}
                          </div>
                        )}

                      {activeVideo && panel === "summary" && (
                        <div className="grid gap-4 rounded-md bg-muted p-4 text-sm leading-7">
                          <div>
                            <h2 className="font-bold">Саммари</h2>
                            <p className="mt-2 text-muted-foreground">
                              {activeVideo.transcript
                                ? "Готово к генерации саммари."
                                : "Сначала сгенерируйте AI-транскрипт."}
                            </p>
                          </div>
                          {activeVideo.summary ? (
                            <p className="whitespace-pre-wrap">{activeVideo.summary}</p>
                          ) : null}
                          <Button
                            type="button"
                            className="w-fit"
                            disabled={busy === "summary" || !activeVideo.transcript}
                            onClick={generateSummary}>
                            {busy === "summary"
                              ? "Генерирую..."
                              : activeVideo.summary
                                ? "Обновить саммари"
                                : "Сгенерировать саммари"}
                          </Button>
                        </div>
                      )}

                      {activeVideo && panel === "transcript" && (
                        <div className="grid gap-3">
                          <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-2">
                            <div className="relative">
                              <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                              <Input
                                value={transcriptQuery}
                                onChange={(event) =>
                                  setTranscriptQuery(event.target.value)
                                }
                                placeholder="Поиск по транскрипту"
                                className="pl-9"
                              />
                            </div>
                            <Button
                              type="button"
                              variant="outline"
                              size="icon"
                              title="Фокус на текущий момент"
                              onClick={focusCurrentTranscript}>
                              <Crosshair2Icon />
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="icon"
                              title={
                                copiedTranscript
                                  ? "Транскрипт скопирован"
                                  : "Скопировать транскрипт"
                              }
                              onClick={copyTranscript}>
                              {copiedTranscript ? <CheckIcon /> : <ClipboardCopyIcon />}
                            </Button>
                          </div>
                          {showToast ? (
                            <div className="flex items-center gap-3 rounded-md border bg-muted p-4 text-sm leading-6 text-muted-foreground">
                              <span>{activeVideo.transcriptStatus}</span>
                              <button
                                type="button"
                                className="ml-auto rounded px-2 py-1 text-muted-foreground hover:bg-background hover:text-foreground"
                                onClick={() =>
                                  setHiddenToasts((items) => ({
                                    ...items,
                                    [toastKey]: true
                                  }))
                                }>
                                x
                              </button>
                            </div>
                          ) : null}
                          <div className="grid h-full gap-1.5 overflow-auto pr-1">
                            {filteredLines.map(({ line, index }) => (
                              <button
                                key={`${line.start}-${line.text}`}
                                type="button"
                                data-active-transcript={
                                  index === activeLine ? "true" : undefined
                                }
                                onClick={() =>
                                  playerCommand("seekTo", [line.start, true])
                                }
                                className={cn(
                                  "grid gap-3 rounded-md border p-3 text-left transition-colors",
                                  index === activeLine
                                    ? "border-primary bg-accent"
                                    : "border-border bg-card"
                                )}>
                                <span className="flex flex-wrap items-center gap-1.5">
                                  <span className="inline-flex h-8 items-center gap-1.5 rounded-md border bg-background px-2.5 text-xs font-medium text-primary">
                                    <ClockIcon className="h-3.5 w-3.5 text-muted-foreground" />
                                    {formatTime(line.start)} · {formatTime(line.end)}
                                  </span>
                                  <span className="inline-flex h-8 items-center rounded-md border bg-background px-2.5 text-xs font-medium">
                                    {line.speaker}
                                  </span>
                                </span>
                                <span className="text-sm leading-6">{line.text}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </ScrollArea>

                    {panel === "chat" ? (
                      <form onSubmit={ask} className="border-t p-4">
                        <div className="relative">
                          <Textarea
                            value={prompt}
                            onChange={(event) => setPrompt(event.target.value)}
                            placeholder="Напишите сообщение."
                            className="min-h-[72px] resize-none px-6 py-5 pr-16"
                          />
                          <Button
                            type="submit"
                            variant="outline"
                            size="icon"
                            disabled={!prompt.trim() || !activeVideo || busy === "chat"}
                            className="absolute right-3 top-3">
                            <PaperPlaneIcon />
                          </Button>
                        </div>
                      </form>
                    ) : null}
                  </div>
                </Tabs>
              </aside>
            </CardContent>
          </Card>
        )}
      </section>
    </main>
  )
}

function EmptyState() {
  return (
    <div className="mx-auto flex max-w-[360px] flex-col items-center pt-20 text-center">
      <h2 className="text-2xl font-medium">Видео не выбрано</h2>
      <p className="mt-6 leading-7 text-muted-foreground">
        Добавьте ссылку под плеером, чтобы создать плейлист и запустить AI-функции.
      </p>
    </div>
  )
}

function ProfilePage({
  apiKey,
  model,
  provider,
  providerId,
  saved,
  onApiKey,
  onModel,
  onProvider,
  onSave,
  onBack
}: {
  apiKey: string
  model: string
  provider: Provider
  providerId: string
  saved: boolean
  onApiKey: (value: string) => void
  onModel: (value: string) => void
  onProvider: (value: string) => void
  onSave: () => void
  onBack: () => void
}) {
  return (
    <Card>
      <CardContent className="grid gap-6 p-6 lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="rounded-md bg-muted p-5">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <PersonIcon className="h-6 w-6" />
          </div>
          <h1 className="mt-5 text-2xl font-semibold">Профиль</h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            Ключ хранится в localStorage этого браузера.
          </p>
          <div className="mt-6 rounded-md border bg-card p-4 text-sm">
            <p className="font-medium">Текущая настройка</p>
            <p className="mt-2 text-muted-foreground">{provider.name}</p>
            <p className="text-muted-foreground">{model}</p>
            <p
              className={cn(
                "mt-3 font-medium",
                apiKey ? "text-primary" : "text-muted-foreground"
              )}>
              {apiKey ? "API-ключ добавлен" : "API-ключ не добавлен"}
            </p>
          </div>
        </aside>

        <div className="grid gap-5">
          <Card>
            <CardHeader>
              <CardTitle>AI-провайдер</CardTitle>
              <CardDescription>
                Deepgram работает для точного транскрипта с таймкодами и спикерами.
                OpenRouter и OpenAI работают для саммари и чата.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="mt-5 grid gap-3 md:grid-cols-2">
                {providers.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onProvider(item.id)}
                    className={cn(
                      "rounded-md border p-4 text-left transition-colors",
                      item.id === providerId
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-card hover:bg-accent hover:text-accent-foreground"
                    )}>
                    <span className="font-semibold">{item.name}</span>
                    <span
                      className={cn(
                        "mt-2 block text-sm",
                        item.id === providerId
                          ? "text-primary-foreground/80"
                          : "text-muted-foreground"
                      )}>
                      {item.canTranscribe && item.canChat
                        ? "транскрипт, саммари, чат"
                        : item.canTranscribe
                          ? "точный транскрипт"
                          : item.canChat
                            ? "саммари и чат"
                            : "пока не подключен"}
                    </span>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Доступ к модели</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="grid gap-2">
                  <Label>Модель</Label>
                  <Select value={model} onValueChange={onModel}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {provider.models.map((item) => (
                        <SelectItem key={item} value={item}>
                          {item}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label>API-ключ</Label>
                  <Input
                    type="password"
                    value={apiKey}
                    onChange={(event) => onApiKey(event.target.value)}
                    placeholder={`API-ключ ${provider.name}`}
                  />
                </div>
              </div>
              <div className="mt-5 flex flex-wrap gap-3">
                <Button type="button" className="gap-2" onClick={onSave}>
                  {saved ? <CheckIcon /> : null}
                  {saved ? "Сохранено" : "Сохранить профиль"}
                </Button>
                <Button type="button" variant="outline" onClick={onBack}>
                  Вернуться к плееру
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </CardContent>
    </Card>
  )
}
