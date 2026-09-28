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
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react"

import {
  ApiError,
  fetchTranscript,
  fetchTranscriptProviders,
  streamAi,
  translateBatch,
  type TranscriptProviderInfo
} from "./api"
import { useSession } from "./auth"
import { Markdown } from "./Markdown"
import { findActiveIndex } from "./player/clock"
import { DebugPanel } from "./player/DebugPanel"
import { recordHighlight } from "./player/debugStats"
import { usePlayerClock } from "./player/usePlayerClock"
import { embedUrl } from "./player/youtube"
import { ProfilePage } from "./profile/ProfilePage"
import { buildTimedTranscript } from "./timestamps"
import { planBatches } from "./translation/batches"
import { languageByCode } from "./translation/languages"
import { TranslatePicker } from "./translation/TranslatePicker"

type Panel = "summary" | "transcript" | "chat"
/** at — время отправки/ответа (ms). У сообщений, созданных до этой версии, его нет. */
type Message = { role: "user" | "assistant"; text: string; at?: number }
type TranscriptSegment = {
  start: number
  end: number
  speaker?: string
  text: string
  /** время оценено провайдером приблизительно (только метка абзаца) */
  approximate?: boolean
}
type VideoItem = {
  id: string
  url: string
  title: string
  transcript: string
  transcriptSegments?: TranscriptSegment[]
  summary: string
  transcriptStatus: string
  /** какой транскрипт-провайдер отдал текст */
  transcriptProvider?: string
  transcriptLanguage?: string
  /** переводы фраз по коду языка: индекс = индекс фразы в транскрипте */
  translations?: Record<string, (string | null)[]>
  /** какой перевод показывать (null — без перевода) */
  translationLang?: string | null
  messages: Message[]
}

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

/** Время сообщения: «14:05» сегодня, «вчера, 14:05», иначе «25.09, 14:05». */
function formatMessageTime(at: number, now = new Date()) {
  const d = new Date(at)
  const hm = d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diff = Math.round((day(now) - day(d)) / 86_400_000)
  if (diff === 0) return hm
  if (diff === 1) return `вчера, ${hm}`
  const date = d.toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {})
  })
  return `${date}, ${hm}`
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
    speaker: segment.speaker || "",
    text,
    approximate: Boolean(segment.approximate)
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
  const { session } = useSession()
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const clock = usePlayerClock(iframeRef, activeId || undefined)
  const playerTime = clock.time
  const videoDuration = clock.duration
  const debug = useMemo(
    () => new URLSearchParams(window.location.search).get("debug") === "1",
    []
  )
  const [transcriptProviders, setTranscriptProviders] = useState<
    TranscriptProviderInfo[]
  >([])
  const [transcriptProviderChoice, setTranscriptProviderChoice] = useState<string>(
    readLocal("scribeowl.transcriptProvider", "auto")
  )
  const lastUserScrollAt = useRef(0)

  const activeVideo = playlist.find((item) => item.id === activeId) || null
  const toastKey = activeVideo ? `${activeVideo.id}:${activeVideo.transcriptStatus}` : ""
  const showToast = Boolean(activeVideo?.transcriptStatus && !hiddenToasts[toastKey])
  const playerSrc = activeVideo ? embedUrl(activeVideo.id) : ""
  const lines = useMemo(() => {
    const storedSegments = activeVideo?.transcriptSegments
      ?.map(normalizeSegment)
      .filter(isTranscriptSegment)
      .sort((a, b) => a.start - b.start)
    if (storedSegments?.length) return storedSegments

    const items = transcriptLines(activeVideo?.transcript || "")
    const step = videoDuration && items.length ? videoDuration / items.length : 30
    return items.map((line, index) => ({
      ...speakerLine(line),
      start: index * step,
      end: (index + 1) * step,
      // время из длины видео, а не от провайдера — только приблизительно
      approximate: true
    }))
  }, [activeVideo?.transcript, activeVideo?.transcriptSegments, videoDuration])
  const lineStarts = useMemo(() => lines.map((line) => line.start), [lines])
  // бинарный поиск по start: активна последняя фраза, начавшаяся до текущего времени
  const activeLine = findActiveIndex(lineStarts, playerTime)
  const translationLang = activeVideo?.translationLang ?? null
  const translated =
    (translationLang && activeVideo?.translations?.[translationLang]) || null
  const query = transcriptQuery.trim().toLowerCase()
  const filteredLines = lines
    .map((line, index) => ({ line, index }))
    .filter(
      ({ line, index }) =>
        isTranscriptSegment(line) &&
        (line.text.toLowerCase().includes(query) ||
          Boolean(translated?.[index]?.toLowerCase().includes(query)))
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
    () => localStorage.setItem("scribeowl.hiddenToasts", JSON.stringify(hiddenToasts)),
    [hiddenToasts]
  )

  useEffect(() => {
    localStorage.setItem(
      "scribeowl.transcriptProvider",
      JSON.stringify(transcriptProviderChoice)
    )
  }, [transcriptProviderChoice])

  // ключи провайдеров больше не живут в браузере — вычищаем старые значения прототипа
  useEffect(() => {
    for (const key of ["scribeowl.apiKey", "scribeowl.model", "scribeowl.providerId"])
      localStorage.removeItem(key)
  }, [])

  const reloadTranscriptProviders = useCallback(() => {
    fetchTranscriptProviders()
      .then(setTranscriptProviders)
      .catch(() => setTranscriptProviders([]))
  }, [])
  // перезапрашиваем при входе/выходе: статус ключей пользователя
  useEffect(() => {
    reloadTranscriptProviders()
  }, [reloadTranscriptProviders, session?.user.id])

  // автоскролл к активной фразе, но не если пользователь сам листал последние 5 с
  useEffect(() => {
    if (performance.now() - lastUserScrollAt.current < 5000) return
    scrollToActiveLine("center")
  }, [activeLine, panel])

  // debug: через сколько после seek подсветка встала на нужную фразу
  useEffect(() => {
    if (!debug || activeLine < 0) return
    const line = lines[activeLine]
    const next = lines[activeLine + 1]
    recordHighlight(
      clock.statsRef.current,
      performance.now(),
      line.start,
      next ? next.start : null
    )
  }, [activeLine, clock.lastSeekAt, debug, lines, clock.statsRef])

  // скроллим только список фраз (не окно — иначе плеер уезжает из вида)
  // активная фраза держится посередине панели транскрипта
  function scrollToActiveLine(block: "center", behavior: ScrollBehavior = "smooth") {
    const el = document.querySelector<HTMLElement>('[data-active-transcript="true"]')
    const box = el?.closest<HTMLElement>("[data-radix-scroll-area-viewport]")
    if (!el || !box) return
    const e = el.getBoundingClientRect()
    const b = box.getBoundingClientRect()
    const top = e.top - b.top + box.scrollTop - (b.height - e.height) / 2
    if (Math.abs(box.scrollTop - Math.max(0, top)) < 2) return
    box.scrollTo({ top: Math.max(0, top), behavior })
  }

  const markUserScroll = useCallback(() => {
    lastUserScrollAt.current = performance.now()
  }, [])

  function patchVideo(id: string, patch: Partial<VideoItem>) {
    setPlaylist((items) =>
      items.map((item) => (item.id === id ? { ...item, ...patch } : item))
    )
  }

  function focusCurrentTranscript() {
    lastUserScrollAt.current = 0
    setPanel("transcript")
    window.requestAnimationFrame(() => scrollToActiveLine("center"))
  }

  async function copyTranscript() {
    if (!lines.length) return
    const text = lines
      .map(
        (line, index) =>
          `[${line.approximate ? "≈" : ""}${formatTime(line.start)} - ${formatTime(line.end)}] ${line.speaker ? `${line.speaker}: ` : ""}${line.text}` +
          (translated?.[index] ? `\n    ${translated[index]}` : "")
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

  function providerName(id?: string | null) {
    return transcriptProviders.find((item) => item.id === id)?.name || id || ""
  }

  async function loadTranscript(
    video: Pick<VideoItem, "id" | "url" | "title">,
    choice = transcriptProviderChoice
  ) {
    setBusy("transcript")
    patchVideo(video.id, { transcriptStatus: "Загружаю транскрипт..." })
    try {
      const data = await fetchTranscript({
        video_id: video.id,
        provider_id: choice === "auto" ? undefined : choice
      })
      // провайдер без времени фраз (EasyTranscriber): только текст — строки разложатся по длине видео (≈)
      const approximate =
        data.timed === false || data.segments.some((item) => item.approximate)
      patchVideo(video.id, {
        ...(data.title && video.title.startsWith("YouTube-видео:")
          ? { title: data.title }
          : {}),
        transcript: data.segments.length
          ? data.segments.map((item) => item.text).join("\n")
          : data.text || "",
        transcriptSegments: data.segments.map((item) => ({
          start: item.start,
          end: item.end,
          text: item.text,
          approximate: item.approximate
        })),
        transcriptProvider: data.provider_id,
        transcriptLanguage: data.language,
        // новые фразы → старые переводы по индексам больше не совпадают
        translations: {},
        transcriptStatus: `Транскрипт: ${providerName(data.provider_id)} · ${data.language} · ${data.segments.length} фраз${approximate ? " · ≈ время фраз приблизительное" : ""}`
      })
    } catch (error) {
      const e = error instanceof ApiError ? error : null
      const who = e?.providerId ? ` (${providerName(e.providerId)})` : ""
      patchVideo(video.id, {
        transcriptStatus: `Транскрипт не получен${who}: ${
          error instanceof Error ? error.message : "ошибка"
        }${e?.code ? ` [${e.code}]` : ""}`
      })
    } finally {
      setBusy("")
    }
  }

  async function loadUrl(event: FormEvent) {
    event.preventDefault()
    const id = getYouTubeId(url)
    if (!id) return
    const next: VideoItem = {
      id,
      url,
      title: `YouTube-видео: ${id}`,
      transcript: "",
      transcriptSegments: [],
      summary: "",
      transcriptStatus: "Загружаю транскрипт...",
      messages: []
    }
    setPlaylist((items) => [next, ...items.filter((item) => item.id !== id)])
    setActiveId(id)
    setPanel("transcript")
    setUrl("")
    await loadTranscript(next)
  }

  // ---------- перевод транскрипта ----------
  const [translateJob, setTranslateJob] = useState<{
    videoId: string
    lang: string
    done: number
    total: number
    running: boolean
    error?: string
    /** остановлен пользователем (а не закончился) */
    stopped?: boolean
  } | null>(null)
  const translateAbort = useRef<AbortController | null>(null)

  function mergeTranslation(
    videoId: string,
    lang: string,
    total: number,
    items: { i: number; text: string }[]
  ) {
    setPlaylist((all) =>
      all.map((v) => {
        if (v.id !== videoId) return v
        const prev = v.translations?.[lang] ?? []
        const next = Array.from({ length: total }, (_, k) => prev[k] ?? null)
        for (const it of items) if (it.i < total) next[it.i] = it.text
        return { ...v, translations: { ...(v.translations ?? {}), [lang]: next } }
      })
    )
  }

  async function runTranslation(video: VideoItem, code: string) {
    translateAbort.current?.abort()
    const lang = languageByCode(code)
    if (!lang) return
    const texts = lines.map((l) => l.text)
    const total = texts.length
    const existing = video.translations?.[code] ?? []
    const batches = planBatches(texts, existing, activeLine >= 0 ? activeLine : 0)
    let done = texts.filter((_, i) => existing[i]).length
    if (!session) {
      setTranslateJob({
        videoId: video.id,
        lang: code,
        done,
        total,
        running: false,
        error: "Войдите в профиле, чтобы переводить."
      })
      return
    }
    if (!batches.length) {
      setTranslateJob({ videoId: video.id, lang: code, done, total, running: false })
      return
    }
    const ctrl = new AbortController()
    translateAbort.current = ctrl
    setTranslateJob({ videoId: video.id, lang: code, done, total, running: true })
    const local = Array.from({ length: total }, (_, k) => existing[k] ?? null)
    const queue = [...batches]
    const worker = async () => {
      while (queue.length && !ctrl.signal.aborted) {
        const batch = queue.shift()!
        const res = await translateBatch(
          { target_language: lang.prompt, title: video.title, segments: batch },
          ctrl.signal
        )
        if (ctrl.signal.aborted) return
        mergeTranslation(video.id, code, total, res.items)
        for (const it of res.items) if (it.i < total) local[it.i] = it.text
        done += res.items.length
        setTranslateJob((j) =>
          j && j.videoId === video.id && j.lang === code ? { ...j, done } : j
        )
      }
    }
    try {
      await Promise.all([worker(), worker()]) // 2 пачки параллельно — быстрее, но без лишней нагрузки на лимиты
      // модель иногда пропускает строку — один повторный проход только по пропущенным
      if (!ctrl.signal.aborted) {
        queue.push(...planBatches(texts, local, 0))
        if (queue.length) await Promise.all([worker(), worker()])
      }
      if (!ctrl.signal.aborted)
        setTranslateJob((j) =>
          j && j.videoId === video.id ? { ...j, running: false } : j
        )
    } catch (error) {
      if (ctrl.signal.aborted) return
      ctrl.abort()
      setTranslateJob((j) =>
        j && j.videoId === video.id
          ? { ...j, running: false, error: aiErrorText(error) }
          : j
      )
    }
  }

  function stopTranslation() {
    translateAbort.current?.abort()
    setTranslateJob((j) => (j ? { ...j, running: false, stopped: true } : j))
  }

  function chooseTranslation(code: string | null) {
    if (!activeVideo) return
    patchVideo(activeVideo.id, { translationLang: code })
    if (!code) {
      stopTranslation()
      setTranslateJob(null)
      return
    }
    runTranslation({ ...activeVideo, translationLang: code }, code)
  }

  // смена видео — останавливаем перевод предыдущего
  useEffect(() => {
    translateAbort.current?.abort()
    setTranslateJob(null)
  }, [activeId])

  // клик по таймкоду в ответе AI → перемотка + подсветка фразы в транскрипте
  const seekFromAnswer = useCallback(
    (seconds: number) => {
      lastUserScrollAt.current = 0
      clock.seekTo(seconds)
    },
    [clock.seekTo]
  )

  function aiPrecondition(): string | null {
    if (!session) return "Войдите в профиле, чтобы пользоваться AI."
    if (!activeVideo) return "Сначала добавьте видео."
    if (!activeVideo.transcript.trim()) return "Сначала загрузите транскрипт."
    return null
  }

  function aiErrorText(error: unknown) {
    if (error instanceof ApiError && error.code === "not_configured")
      return `${error.message}. Откройте «Профиль».`
    return error instanceof Error ? error.message : "AI-запрос не выполнен"
  }

  async function ask(event: FormEvent) {
    event.preventDefault()
    const text = prompt.trim()
    if (!activeVideo || !text || busy) return
    const video = activeVideo
    const history: Message[] = [...video.messages, { role: "user", text, at: Date.now() }]
    setPrompt("")
    const blocked = aiPrecondition()
    if (blocked) {
      patchVideo(video.id, {
        messages: [...history, { role: "assistant", text: blocked, at: Date.now() }]
      })
      return
    }
    setBusy("chat")
    let answer = ""
    const answeredAt = Date.now()
    const render = (value: string) =>
      patchVideo(video.id, {
        messages: [...history, { role: "assistant", text: value, at: answeredAt }]
      })
    render("…")
    try {
      await streamAi(
        {
          task: "chat",
          title: video.title,
          transcript: buildTimedTranscript(video.transcriptSegments, video.transcript),
          messages: history.slice(-20).map((m) => ({ role: m.role, content: m.text }))
        },
        (delta) => {
          answer += delta
          render(answer)
        }
      )
      if (!answer) render("Пустой ответ модели.")
    } catch (error) {
      render(answer ? `${answer}\n\n[обрыв: ${aiErrorText(error)}]` : aiErrorText(error))
    } finally {
      setBusy("")
    }
  }

  async function generateSummary() {
    if (!activeVideo || busy) return
    const video = activeVideo
    const blocked = aiPrecondition()
    if (blocked) {
      patchVideo(video.id, { summary: blocked })
      return
    }
    setBusy("summary")
    let summary = ""
    patchVideo(video.id, { summary: "…" })
    try {
      await streamAi(
        {
          task: "summary",
          title: video.title,
          transcript: buildTimedTranscript(video.transcriptSegments, video.transcript)
        },
        (delta) => {
          summary += delta
          patchVideo(video.id, { summary })
        }
      )
    } catch (error) {
      patchVideo(video.id, {
        summary: summary
          ? `${summary}\n\n[обрыв: ${aiErrorText(error)}]`
          : aiErrorText(error)
      })
    } finally {
      setBusy("")
    }
  }

  return (
    // lg+: приложение ровно в высоту окна, страница не скроллится — скроллятся плейлист и панель справа
    <main className="flex min-h-screen flex-col overflow-x-hidden bg-background text-foreground lg:h-screen lg:overflow-hidden">
      <section className="container flex min-h-0 flex-1 flex-col py-3">
        <header className="mb-3 flex shrink-0 items-center justify-between gap-4 px-1">
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
            {session?.user.email ?? "Войти"}
          </Button>
        </header>

        {page === "profile" ? (
          <div className="min-h-0 flex-1 lg:overflow-auto">
            <ProfilePage
              session={session}
              onBack={() => setPage("player")}
              transcriptProviders={transcriptProviders}
              transcriptChoice={transcriptProviderChoice}
              onTranscriptChoice={setTranscriptProviderChoice}
              onTranscriptProvidersChanged={reloadTranscriptProviders}
            />
          </div>
        ) : (
          <Card className="lg:min-h-0 lg:flex-1">
            <CardContent className="grid gap-4 p-4 lg:h-full lg:grid-cols-[minmax(0,1fr)_minmax(360px,460px)] lg:grid-rows-[minmax(0,1fr)]">
              <section className="flex min-w-0 flex-col overflow-hidden lg:min-h-0">
                <div className="shrink-0 overflow-hidden rounded-md border bg-muted">
                  {activeVideo ? (
                    <iframe
                      key={activeVideo.id}
                      id={`youtube-player-${activeVideo.id}`}
                      ref={iframeRef}
                      title={activeVideo.title}
                      src={playerSrc}
                      onLoad={clock.onIframeLoad}
                      className="aspect-video max-h-[55vh] min-h-[200px] lg:max-h-[min(55vh,calc(100vh_-_420px))] w-full"
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                      allowFullScreen
                    />
                  ) : (
                    <div className="flex aspect-video max-h-[55vh] min-h-[200px] lg:max-h-[min(55vh,calc(100vh_-_420px))] w-full items-center justify-center px-8 text-center text-muted-foreground">
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

                {debug && activeVideo ? (
                  <DebugPanel clockRef={clock.clockRef} statsRef={clock.statsRef} />
                ) : null}

                <div className="mt-3 shrink-0">
                  <h1 className="line-clamp-2 text-lg font-bold leading-snug">
                    {activeVideo?.title || "Плеер пуст"}
                  </h1>
                </div>

                <form onSubmit={loadUrl} className="mt-3 flex shrink-0 gap-2">
                  <Input
                    value={url}
                    onChange={(event) => setUrl(event.target.value)}
                    placeholder="Вставьте ссылку на YouTube"
                    className="h-11"
                  />
                  <Button className="h-11">Загрузить видео</Button>
                </form>

                {/* плейлист: вся оставшаяся высота, скролл внутри */}
                <section className="mt-3 flex min-h-[200px] w-full flex-1 flex-col overflow-hidden rounded-lg border bg-muted p-4 lg:min-h-0">
                  <h2 className="mb-3 shrink-0 text-sm font-semibold">
                    Плейлист
                    {playlist.length ? (
                      <span className="ml-2 font-normal text-muted-foreground">
                        {playlist.length}
                      </span>
                    ) : null}
                  </h2>
                  {playlist.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      Пусто — вставьте ссылку на YouTube выше.
                    </p>
                  ) : null}
                  <div className="-mx-1 grid min-h-0 flex-1 content-start gap-2 overflow-y-auto px-1 pb-1">
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
                                setActiveId(item.id)
                                setPanel("transcript")
                                loadTranscript(item)
                              }}>
                              {item.transcript
                                ? "Обновить транскрипт"
                                : "Загрузить транскрипт"}
                            </button>
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </section>
              </section>

              <aside className="h-[75vh] min-w-0 overflow-hidden rounded-lg border bg-card lg:h-full lg:min-h-0">
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
                      onWheel={markUserScroll}
                      onTouchMove={markUserScroll}
                      onPointerDown={(event) => {
                        // перетаскивание скроллбара (у кнопок фраз нет data-orientation)
                        if ((event.target as HTMLElement).closest("[data-orientation]"))
                          markUserScroll()
                      }}
                      onKeyDown={(event) => {
                        if (
                          [
                            "ArrowUp",
                            "ArrowDown",
                            "PageUp",
                            "PageDown",
                            "Home",
                            "End",
                            " "
                          ].includes(event.key)
                        )
                          markUserScroll()
                      }}
                      className={cn(
                        // Radix оборачивает контент в display:table — он растягивается по самой длинной строке
                        "min-h-0 px-3 py-3 [&_[data-radix-scroll-area-viewport]>div]:!block",
                        panel === "transcript" && "h-full"
                      )}>
                      {!activeVideo && <EmptyState />}

                      {activeVideo &&
                        panel === "chat" &&
                        activeVideo.messages.length === 0 && (
                          <div className="mx-auto flex max-w-[360px] flex-col items-center pt-7 text-center">
                            <h2 className="text-2xl font-medium">YouTube AI</h2>
                            <p className="mt-8 leading-7 text-muted-foreground">
                              Вопросы по видео — после загрузки транскрипта.
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
                          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3">
                            {activeVideo.messages.map((message, index) => (
                              <div
                                key={index}
                                className={cn(
                                  // длинные URL/идентификаторы переносим, переводы строк сохраняем
                                  "w-fit min-w-0 max-w-[85%] rounded-md border p-3 text-sm leading-6 [overflow-wrap:anywhere]",
                                  message.role === "user"
                                    ? "ml-auto whitespace-pre-wrap bg-primary text-primary-foreground"
                                    : "bg-muted"
                                )}>
                                {message.role === "assistant" ? (
                                  <Markdown
                                    onSeek={seekFromAnswer}
                                    duration={videoDuration || undefined}>
                                    {message.text}
                                  </Markdown>
                                ) : (
                                  message.text
                                )}
                                {message.at ? (
                                  <time
                                    dateTime={new Date(message.at).toISOString()}
                                    title={new Date(message.at).toLocaleString("ru-RU")}
                                    className={cn(
                                      "mt-1 block text-right text-[11px] leading-4",
                                      message.role === "user"
                                        ? "text-primary-foreground/70"
                                        : "text-muted-foreground"
                                    )}>
                                    {formatMessageTime(message.at)}
                                  </time>
                                ) : null}
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
                                : "Сначала загрузите транскрипт."}
                            </p>
                          </div>
                          {activeVideo.summary ? (
                            <Markdown
                              onSeek={seekFromAnswer}
                              duration={videoDuration || undefined}>
                              {activeVideo.summary}
                            </Markdown>
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
                          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                            <Select
                              value={transcriptProviderChoice}
                              onValueChange={setTranscriptProviderChoice}>
                              <SelectTrigger aria-label="Провайдер транскрипта">
                                <SelectValue placeholder="Провайдер" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="auto">
                                  Авто (по порядку с фолбэком)
                                </SelectItem>
                                {transcriptProviders.map((item) => (
                                  <SelectItem
                                    key={item.id}
                                    value={item.id}
                                    disabled={!item.configured}>
                                    {item.name}
                                    {item.configured ? "" : " — нет ключа на сервере"}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <Button
                              type="button"
                              variant="outline"
                              disabled={busy === "transcript"}
                              onClick={() => loadTranscript(activeVideo)}>
                              {busy === "transcript"
                                ? "Загружаю..."
                                : activeVideo.transcript
                                  ? "Обновить"
                                  : "Загрузить"}
                            </Button>
                          </div>
                          {activeVideo.transcriptProvider ? (
                            <p className="text-xs text-muted-foreground">
                              Источник: {providerName(activeVideo.transcriptProvider)}
                              {activeVideo.transcriptLanguage
                                ? ` · ${activeVideo.transcriptLanguage}`
                                : ""}
                            </p>
                          ) : null}
                          <div className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] gap-2">
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
                              title="К текущей фразе"
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
                            <TranslatePicker
                              value={translationLang}
                              busy={Boolean(translateJob?.running)}
                              onConfirm={chooseTranslation}
                            />
                          </div>
                          {translationLang &&
                          translateJob &&
                          translateJob.videoId === activeVideo.id ? (
                            <div
                              className={cn(
                                "flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-xs",
                                translateJob.error
                                  ? "border-destructive text-destructive"
                                  : "text-muted-foreground"
                              )}>
                              {translateJob.error ? (
                                <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                                  Перевод остановлен: {translateJob.error}
                                </span>
                              ) : (
                                <span className="flex-1">
                                  Перевод на{" "}
                                  {languageByCode(translateJob.lang)?.label.toLowerCase()}
                                  : {Math.min(translateJob.done, translateJob.total)} из{" "}
                                  {translateJob.total}
                                  {translateJob.running
                                    ? "…"
                                    : translateJob.done >= translateJob.total
                                      ? " — готово"
                                      : translateJob.stopped
                                        ? " — остановлен"
                                        : ` — готово, без перевода: ${translateJob.total - translateJob.done}`}
                                </span>
                              )}
                              {translateJob.running ? (
                                <button
                                  type="button"
                                  className="underline underline-offset-2"
                                  onClick={stopTranslation}>
                                  Остановить
                                </button>
                              ) : translateJob.done < translateJob.total ? (
                                <button
                                  type="button"
                                  className="underline underline-offset-2"
                                  onClick={() =>
                                    runTranslation(activeVideo, translateJob.lang)
                                  }>
                                  {translateJob.error
                                    ? "Повторить"
                                    : translateJob.stopped
                                      ? "Продолжить"
                                      : "Допереводить"}
                                </button>
                              ) : null}
                              <div className="h-1 w-full overflow-hidden rounded bg-muted">
                                <div
                                  className="h-full bg-primary transition-all"
                                  style={{
                                    width: `${(100 * translateJob.done) / Math.max(1, translateJob.total)}%`
                                  }}
                                />
                              </div>
                            </div>
                          ) : null}
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
                                onClick={() => clock.seekTo(line.start)}
                                className={cn(
                                  "grid gap-1 rounded-md border px-3 py-2 text-left transition-colors",
                                  index === activeLine
                                    ? "border-primary bg-accent"
                                    : "border-border bg-card hover:bg-accent/50"
                                )}>
                                {/* таймкод — второстепенный: мелко, бледно, без рамки */}
                                <span className="text-[11px] leading-4 text-muted-foreground/80">
                                  {line.approximate ? (
                                    <span title="Время фразы приблизительное">≈ </span>
                                  ) : null}
                                  {formatTime(line.start)} – {formatTime(line.end)}
                                  {line.speaker ? ` · ${line.speaker}` : ""}
                                </span>
                                {translationLang ? (
                                  <span className="grid grid-cols-2 gap-3">
                                    <span className="min-w-0 text-sm leading-6 [overflow-wrap:anywhere]">
                                      {line.text}
                                    </span>
                                    <span
                                      className={cn(
                                        "min-w-0 border-l pl-3 text-sm leading-6 [overflow-wrap:anywhere]",
                                        translated?.[index]
                                          ? "text-foreground/80"
                                          : "text-muted-foreground/60"
                                      )}>
                                      {translated?.[index] ?? "…"}
                                    </span>
                                  </span>
                                ) : (
                                  <span className="text-sm leading-6">{line.text}</span>
                                )}
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
