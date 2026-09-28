// Часы плеера поверх YouTube IFrame API — чистые функции (без DOM), покрыты vitest.
//
// reported — то, что вернул player.getCurrentTime() (YouTube обновляет его рывками).
// time     — то, что показываем: reported + интерполяция, но только когда видео реально играет.

export type PlayerState = "unstarted" | "ended" | "playing" | "paused" | "buffering" | "cued"

export const YT_STATES: Record<number, PlayerState> = {
  [-1]: "unstarted",
  0: "ended",
  1: "playing",
  2: "paused",
  3: "buffering",
  5: "cued"
}

export const CLOCK = {
  /** не интерполируем дальше этого от последнего reported (с) */
  maxLead: 1,
  /** PLAYING, но reported не менялся дольше — считаем подвисанием/рекламой (мс) */
  stallMs: 1000,
  /** скачок вперёд больше ожидаемого на столько — seek (с) */
  seekForward: 1.5,
  /** откат назад больше этого — seek (с); защищает от шума float */
  seekBackward: 0.05
}

export type FreezeReason = "buffering" | "paused" | "ended" | "cued" | "unstarted" | "stalled"

export type ClockState = {
  /** последний reported (с) */
  reported: number
  /** момент (performance.now, мс), когда reported последний раз ИЗМЕНИЛСЯ */
  reportedAt: number
  /** якорь интерполяции: time = anchor + (now − anchorAt) · rate. Обычно = reported,
   *  но при смене скорости переякоривается на текущее время, чтобы не было рывка. */
  anchor: number
  anchorAt: number
  /** выходное время (с) */
  time: number
  state: PlayerState
  rate: number
  lastSeekAt: number | null
  frozen: FreezeReason | null
  initialized: boolean
}

export type ClockEvent =
  /** interval = null, если до этого часы стояли (пауза/буфер) — такой интервал не про частоту обновлений */
  | { kind: "report"; at: number; interval: number | null; drift: number | null }
  | { kind: "seek"; at: number; from: number; to: number }
  | { kind: "freeze"; at: number; reason: FreezeReason; time: number }
  | { kind: "resume"; at: number; time: number }

export type ClockInput = { now: number; reported: number; state: PlayerState; rate: number }

export function initialClock(): ClockState {
  return {
    reported: 0,
    reportedAt: 0,
    anchor: 0,
    anchorAt: 0,
    time: 0,
    state: "unstarted",
    rate: 1,
    lastSeekAt: null,
    frozen: "unstarted",
    initialized: false
  }
}

/** Ожидаемое reported сейчас, если бы видео просто играло. */
function expectedReported(s: ClockState, now: number) {
  return s.state === "playing" ? s.anchor + ((now - s.anchorAt) / 1000) * s.rate : s.reported
}

export function freezeReason(s: Pick<ClockState, "state" | "reportedAt">, now: number): FreezeReason | null {
  if (s.state !== "playing") return s.state
  if (now - s.reportedAt > CLOCK.stallMs) return "stalled"
  return null
}

export function interpolate(s: ClockState, now: number): number {
  if (s.frozen) return s.reported
  const lead = ((now - s.anchorAt) / 1000) * s.rate
  // не дальше maxLead от последнего reported
  return Math.min(s.anchor + Math.max(lead, 0), s.reported + CLOCK.maxLead)
}

/** Один шаг часов (на каждый requestAnimationFrame). */
export function tick(prev: ClockState, input: ClockInput): { clock: ClockState; events: ClockEvent[] } {
  const { now, reported, rate } = input
  const events: ClockEvent[] = []

  if (!prev.initialized) {
    const s: ClockState = {
      ...prev,
      reported,
      reportedAt: now,
      anchor: reported,
      anchorAt: now,
      state: input.state,
      rate,
      initialized: true,
      frozen: null,
      time: reported
    }
    s.frozen = freezeReason(s, now)
    return { clock: s, events }
  }

  let s: ClockState = { ...prev }

  if (reported !== prev.reported) {
    const expected = expectedReported(prev, now)
    const jumpedBack = reported < prev.reported - CLOCK.seekBackward
    const jumpedForward = reported - expected > CLOCK.seekForward
    if (jumpedBack || jumpedForward) {
      events.push({ kind: "seek", at: now, from: prev.time, to: reported })
      s.lastSeekAt = now
    } else {
      events.push({
        kind: "report",
        at: now,
        interval: prev.frozen ? null : now - prev.reportedAt,
        // drift = куда мы успели дорисовать − что пришло; только если интерполировали
        drift: prev.frozen ? null : interpolate(prev, now) - reported
      })
    }
    s.reported = reported
    s.reportedAt = now
    s.anchor = reported
    s.anchorAt = now
  }

  // смена скорости: переякорим интерполяцию на текущее время, чтобы не было рывка
  if (rate !== prev.rate && !prev.frozen) {
    s.anchor = interpolate(prev, now)
    s.anchorAt = now
  }
  s.rate = rate

  if (input.state !== prev.state) {
    // смена состояния: фиксируемся на reported; в PLAYING интерполяция стартует с «сейчас»
    s.anchor = s.reported
    s.anchorAt = now
    s.reportedAt = now
  }
  s.state = input.state

  const reason = freezeReason(s, now)
  if (reason && !prev.frozen) events.push({ kind: "freeze", at: now, reason, time: s.reported })
  if (!reason && prev.frozen) events.push({ kind: "resume", at: now, time: s.reported })
  s.frozen = reason
  s.time = interpolate(s, now)
  return { clock: s, events }
}

/** Индекс последнего сегмента с start <= t (бинарный поиск); -1 до первого. */
export function findActiveIndex(starts: ArrayLike<number>, t: number): number {
  let lo = 0
  let hi = starts.length - 1
  let ans = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (starts[mid] <= t) {
      ans = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  return ans
}
