// Хук: YouTube IFrame API → часы плеера (requestAnimationFrame + clock.ts).
import { useCallback, useEffect, useRef, useState, type RefObject } from "react"

import { initialClock, tick, YT_STATES, type ClockState, type PlayerState } from "./clock"
import { createStats, recordEvents, type DebugStats } from "./debugStats"
import { loadYouTubeApi, type YTPlayer } from "./youtube"

export type PlayerClock = {
  time: number
  state: PlayerState
  playbackRate: number
  lastSeekAt: number | null
  duration: number
  ready: boolean
  seekTo: (seconds: number) => void
  onIframeLoad: () => void
  /** живые данные для debug-панели (мутируются на каждом кадре) */
  clockRef: RefObject<ClockState>
  statsRef: RefObject<DebugStats>
}

/** React-состояние обновляем не чаще, чем время сдвинулось на это (с): список фраз тяжёлый. */
const RENDER_STEP = 0.05

export function usePlayerClock(iframeRef: RefObject<HTMLIFrameElement | null>, videoId: string | undefined): PlayerClock {
  const playerRef = useRef<YTPlayer | null>(null)
  const readyRef = useRef(false)
  /** клик по фразе до onReady (медленная сеть) — применим, когда плеер будет готов */
  const pendingSeekRef = useRef<number | null>(null)
  const clockRef = useRef<ClockState>(initialClock())
  const statsRef = useRef<DebugStats>(createStats())
  const [view, setView] = useState({
    time: 0,
    state: "unstarted" as PlayerState,
    playbackRate: 1,
    lastSeekAt: null as number | null,
    duration: 0,
    ready: false
  })

  // смена видео — сброс
  useEffect(() => {
    clockRef.current = initialClock()
    statsRef.current = createStats()
    readyRef.current = false
    pendingSeekRef.current = null
    setView({ time: 0, state: "unstarted", playbackRate: 1, lastSeekAt: null, duration: 0, ready: false })
    return () => {
      playerRef.current?.destroy()
      playerRef.current = null
    }
  }, [videoId])

  // rAF-цикл
  useEffect(() => {
    let raf = 0
    const loop = () => {
      raf = requestAnimationFrame(loop)
      const player = playerRef.current
      if (!player?.getCurrentTime) return
      let reported: number, stateCode: number, rate: number
      try {
        reported = player.getCurrentTime() || 0
        stateCode = player.getPlayerState()
        rate = player.getPlaybackRate() || 1
      } catch {
        return
      }
      const now = performance.now()
      const { clock, events } = tick(clockRef.current, {
        now,
        reported,
        state: YT_STATES[stateCode] ?? "unstarted",
        rate
      })
      clockRef.current = clock
      if (events.length || statsRef.current.intervals.length) recordEvents(statsRef.current, events, now)
      setView((v) =>
        Math.abs(v.time - clock.time) >= RENDER_STEP ||
        v.state !== clock.state ||
        v.playbackRate !== clock.rate ||
        v.lastSeekAt !== clock.lastSeekAt
          ? { ...v, time: clock.time, state: clock.state, playbackRate: clock.rate, lastSeekAt: clock.lastSeekAt }
          : v
      )
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [videoId])

  const onIframeLoad = useCallback(() => {
    const iframe = iframeRef.current
    if (!iframe) return
    loadYouTubeApi().then((YT) => {
      if (iframeRef.current !== iframe) return
      playerRef.current?.destroy()
      const refreshDuration = (p: YTPlayer) =>
        setView((v) => ({ ...v, duration: p.getDuration?.() || v.duration, ready: true }))
      playerRef.current = new YT.Player(iframe, {
        events: {
          onReady: (e) => {
            readyRef.current = true
            refreshDuration(e.target)
            const pending = pendingSeekRef.current
            pendingSeekRef.current = null
            if (pending !== null) {
              e.target.seekTo(pending, true)
              e.target.playVideo()
            }
          },
          // сами события только обновляют длительность; время/состояние читаем на каждом кадре
          onStateChange: (e) => refreshDuration(e.target),
          onPlaybackRateChange: () => undefined
        }
      })
    })
  }, [iframeRef])

  // ?debug=1: живые часы/замеры доступны из консоли (window.__scribeowlClock)
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("debug") !== "1") return
    ;(window as unknown as Record<string, unknown>).__scribeowlClock = { clockRef, statsRef, playerRef }
  }, [])

  const seekTo = useCallback((seconds: number) => {
    const player = playerRef.current
    if (!player || !readyRef.current) {
      pendingSeekRef.current = seconds
      return
    }
    const state = YT_STATES[player.getPlayerState?.()] ?? "unstarted"
    player.seekTo(seconds, true)
    // до первого запуска (cued/unstarted) YouTube не двигает позицию без воспроизведения
    if (state === "cued" || state === "unstarted") player.playVideo()
  }, [])

  return { ...view, seekTo, onIframeLoad, clockRef, statsRef }
}
