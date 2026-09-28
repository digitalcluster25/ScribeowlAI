// Сбор замеров для ?debug=1 (скользящее окно 30 с) — чистые функции.
import type { ClockEvent, ClockState } from "./clock"

export const WINDOW_MS = 30_000

export type DebugLogEntry = { at: number; text: string }

export type DebugStats = {
  intervals: { at: number; v: number }[]
  drifts: { at: number; v: number }[]
  log: DebugLogEntry[]
  /** для замера «seek → подсветка на верном сегменте» */
  pendingSeek: { at: number; to: number } | null
}

export function createStats(): DebugStats {
  return { intervals: [], drifts: [], log: [], pendingSeek: null }
}

const fmt = (t: number) => t.toFixed(2)

export function recordEvents(stats: DebugStats, events: ClockEvent[], now: number) {
  for (const e of events) {
    if (e.kind === "report") {
      if (e.interval !== null) stats.intervals.push({ at: e.at, v: e.interval })
      if (e.drift !== null) stats.drifts.push({ at: e.at, v: e.drift })
    } else if (e.kind === "seek") {
      stats.pendingSeek = { at: e.at, to: e.to }
      stats.log.push({ at: e.at, text: `seek ${fmt(e.from)} → ${fmt(e.to)} с` })
    } else if (e.kind === "freeze") {
      stats.log.push({ at: e.at, text: `freeze (${e.reason}) @ ${fmt(e.time)} с` })
    } else {
      stats.log.push({ at: e.at, text: `resume @ ${fmt(e.time)} с` })
    }
  }
  const from = now - WINDOW_MS
  stats.intervals = stats.intervals.filter((x) => x.at >= from)
  stats.drifts = stats.drifts.filter((x) => x.at >= from)
  stats.log = stats.log.slice(-30)
}

/** Подсветка встала на сегмент, содержащий цель seek → логируем задержку. */
export function recordHighlight(stats: DebugStats, now: number, segStart: number | null, segEnd: number | null) {
  const p = stats.pendingSeek
  if (!p || segStart === null) return
  if (p.to >= segStart - 0.05 && (segEnd === null || p.to < segEnd + 0.05)) {
    stats.log.push({ at: now, text: `подсветка на сегменте через ${Math.round(now - p.at)} мс после seek` })
    stats.pendingSeek = null
  }
}

export function summary(values: number[]) {
  if (!values.length) return null
  const sum = values.reduce((a, b) => a + b, 0)
  return { min: Math.min(...values), avg: sum / values.length, max: Math.max(...values), n: values.length }
}

export type ClockSnapshot = Pick<ClockState, "reported" | "time" | "state" | "rate" | "frozen" | "lastSeekAt">
