// ?debug=1 — панель замеров ПОД плеером (не поверх iframe).
import { useEffect, useState, type RefObject } from "react"

import type { ClockState } from "./clock"
import { summary, type DebugStats } from "./debugStats"

const ms = (v: number) => `${Math.round(v)} мс`
const s3 = (v: number) => `${v.toFixed(3)} с`

export function DebugPanel({
  clockRef,
  statsRef
}: {
  clockRef: RefObject<ClockState>
  statsRef: RefObject<DebugStats>
}) {
  const [, force] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => force((n) => n + 1), 250)
    return () => window.clearInterval(id)
  }, [])
  const c = clockRef.current
  const st = statsRef.current
  if (!c || !st) return null
  const iv = summary(st.intervals.map((x) => x.v))
  const dr = summary(st.drifts.map((x) => x.v))
  const drAbs = summary(st.drifts.map((x) => Math.abs(x.v)))
  const now = performance.now()

  return (
    <div className="mt-3 rounded-md border bg-muted p-3 font-mono text-xs leading-5" data-testid="debug-panel">
      <div className="grid grid-cols-2 gap-x-6 sm:grid-cols-4">
        <span>reported: {s3(c.reported)}</span>
        <span>interpolated: {s3(c.time)}</span>
        <span>
          state: {c.state}
          {c.frozen ? ` (frozen: ${c.frozen})` : ""}
        </span>
        <span>rate: {c.rate}×</span>
      </div>
      <div className="mt-1">
        интервал reported (30 с):{" "}
        {iv ? `min ${ms(iv.min)} · avg ${ms(iv.avg)} · max ${ms(iv.max)} · n=${iv.n}` : "—"}
      </div>
      <div>
        drift (interp − reported):{" "}
        {dr && drAbs ? `avg ${ms(dr.avg * 1000)} · |avg| ${ms(drAbs.avg * 1000)} · |max| ${ms(drAbs.max * 1000)}` : "—"}
      </div>
      <div className="mt-1 max-h-32 overflow-auto">
        {st.log
          .slice()
          .reverse()
          .map((e, i) => (
            <div key={i}>
              −{((now - e.at) / 1000).toFixed(1)} с · {e.text}
            </div>
          ))}
      </div>
    </div>
  )
}
