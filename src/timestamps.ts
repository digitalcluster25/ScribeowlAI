// Таймкоды для AI: транскрипт с метками [m:ss] → модель цитирует моменты → метки в ответе кликабельны.

export type TimedSegment = { start: number; text: string }

export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, "0")
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`
}

export function parseClock(value: string): number | null {
  const parts = value.split(":").map(Number)
  if (parts.length < 2 || parts.length > 3 || parts.some((p) => !Number.isFinite(p) || p < 0)) return null
  if (parts.slice(1).some((p) => p >= 60)) return null
  return parts.reduce((acc, p) => acc * 60 + p, 0)
}

/** Сегменты → блоки «[m:ss] текст» (≈20 с / 400 символов): метки есть, токенов почти не прибавляется. */
export function buildTimedTranscript(segments: TimedSegment[] | undefined, fallback: string, blockSec = 20, blockChars = 400) {
  if (!segments?.length) return fallback
  const lines: string[] = []
  let start = segments[0].start
  let buf: string[] = []
  let len = 0
  const flush = () => {
    if (buf.length) lines.push(`[${formatClock(start)}] ${buf.join(" ")}`)
    buf = []
    len = 0
  }
  for (const seg of segments) {
    const text = seg.text.trim()
    if (!text) continue
    if (buf.length && (seg.start - start >= blockSec || len + text.length > blockChars)) flush()
    if (!buf.length) start = seg.start
    buf.push(text)
    len += text.length + 1
  }
  flush()
  return lines.join("\n")
}

const CLOCK = String.raw`\d{1,2}:\d{2}(?::\d{2})?`
// [1:23], [1:23–1:40], [01:02:03]; не трогаем уже готовые ссылки [..](..)
const STAMP = new RegExp(String.raw`\[(${CLOCK})(?:\s*[–—-]\s*(${CLOCK}))?\](?!\()`, "g")

/** Метки времени → markdown-ссылки вида [1:23](#t=83). Время за пределами видео не линкуем. */
export function linkifyTimestamps(markdown: string, duration?: number): string {
  return markdown.replace(STAMP, (whole, a: string, b?: string) => {
    const sec = parseClock(a)
    if (sec === null || (duration && sec > duration + 1)) return whole
    const label = b ? `${a}–${b}` : a
    return `[${label}](#t=${sec})`
  })
}

export function seekTarget(href: string | undefined): number | null {
  const m = href?.match(/^#t=(\d+(?:\.\d+)?)$/)
  return m ? Number(m[1]) : null
}
