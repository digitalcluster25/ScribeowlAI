import { describe, expect, it } from "vitest"

import { CLOCK, findActiveIndex, initialClock, tick, type ClockEvent, type ClockState, type PlayerState } from "./clock"

/** Прогон: YouTube отдаёт reported раз в reportEvery мс, rAF — каждые 16 мс. */
function run(
  steps: { ms: number; state?: PlayerState; rate?: number; reported?: (t: number) => number }[],
  reportEvery = 250
) {
  let clock: ClockState = initialClock()
  const events: ClockEvent[] = []
  const samples: { now: number; time: number }[] = []
  let now = 0
  let video = 0 // «истинная» позиция видео
  let lastReport = 0
  let reported = 0
  for (const step of steps) {
    const end = now + step.ms
    while (now < end) {
      now += 16
      const state = step.state ?? "playing"
      const rate = step.rate ?? 1
      if (state === "playing") video += (16 / 1000) * rate
      if (now - lastReport >= reportEvery) {
        reported = step.reported ? step.reported(video) : video
        lastReport = now
      }
      const r = tick(clock, { now, reported, state, rate })
      clock = r.clock
      events.push(...r.events)
      samples.push({ now, time: clock.time })
    }
  }
  return { clock, events, samples, video }
}

describe("interpolation", () => {
  it("идёт плавно между редкими reported и не отстаёт от видео", () => {
    const { samples, events, video, clock } = run([{ ms: 5000 }])
    expect(Math.abs(clock.time - video)).toBeLessThan(0.3)
    // время монотонно растёт почти на каждом кадре (не ступеньками по 250 мс)
    const grows = samples.slice(20).filter((s, i, a) => i > 0 && s.time > a[i - 1].time).length
    expect(grows / (samples.length - 21)).toBeGreaterThan(0.8)
    expect(events.some((e) => e.kind === "seek")).toBe(false)
    const drifts = events.flatMap((e) => (e.kind === "report" && e.drift !== null ? [e.drift] : []))
    expect(Math.max(...drifts.map(Math.abs))).toBeLessThan(0.1)
  })

  it("не уходит дальше maxLead от reported", () => {
    let c = tick(initialClock(), { now: 0, reported: 10, state: "playing", rate: 1 }).clock
    c = tick(c, { now: 100, reported: 10.1, state: "playing", rate: 1 }).clock
    c = tick(c, { now: 900, reported: 10.1, state: "playing", rate: 1 }).clock
    expect(c.time).toBeCloseTo(10.9, 5)
    c = tick(c, { now: 1099, reported: 10.1, state: "playing", rate: 1 }).clock
    expect(c.time - c.reported).toBeLessThanOrEqual(CLOCK.maxLead + 1e-9)
  })
})

describe("freeze", () => {
  it.each(["paused", "buffering", "ended", "cued"] as PlayerState[])("%s → время = reported", (state) => {
    const { clock, events } = run([{ ms: 1000 }, { ms: 1000, state }])
    expect(clock.frozen).toBe(state)
    expect(clock.time).toBe(clock.reported)
    expect(events.some((e) => e.kind === "freeze" && e.reason === state)).toBe(true)
  })

  it("PLAYING, но время не растёт > 1 с (реклама/подвисание) → stalled, потом resume", () => {
    const frozenAt = { v: 0 }
    const { events, clock } = run([
      { ms: 1000 },
      { ms: 2000, reported: (t) => (frozenAt.v ||= t) },
      { ms: 500 }
    ])
    const freeze = events.find((e) => e.kind === "freeze")
    expect(freeze && freeze.kind === "freeze" && freeze.reason).toBe("stalled")
    expect(events.some((e) => e.kind === "resume")).toBe(true)
    expect(clock.frozen).toBe(null)
  })

  it("во время stall время не убегает вперёд больше maxLead", () => {
    let c = tick(initialClock(), { now: 0, reported: 5, state: "playing", rate: 1 }).clock
    for (let now = 16; now < 3000; now += 16) {
      c = tick(c, { now, reported: 5, state: "playing", rate: 1 }).clock
      expect(c.time - 5).toBeLessThanOrEqual(CLOCK.maxLead)
    }
    expect(c.frozen).toBe("stalled")
    expect(c.time).toBe(5)
  })
})

describe("report intervals", () => {
  it("интервал после паузы не считается (null)", () => {
    const { events } = run([{ ms: 1000 }, { ms: 3000, state: "paused" }, { ms: 1000 }])
    const intervals = events.flatMap((e) => (e.kind === "report" && e.interval !== null ? [e.interval] : []))
    expect(Math.max(...intervals)).toBeLessThan(400)
  })
})

describe("seek", () => {
  it("скачок вперёд > 1.5 с — seek, интерполяция сбрасывается", () => {
    const { events, clock } = run([{ ms: 1000 }, { ms: 1000, reported: (t) => t + 30 }])
    const seeks = events.filter((e) => e.kind === "seek")
    expect(seeks).toHaveLength(1)
    expect(clock.lastSeekAt).not.toBeNull()
    expect(clock.time).toBeGreaterThan(30)
  })

  it("любой откат назад — seek", () => {
    let c = tick(initialClock(), { now: 0, reported: 20, state: "playing", rate: 1 }).clock
    const r = tick(c, { now: 250, reported: 19.5, state: "playing", rate: 1 })
    expect(r.events.map((e) => e.kind)).toContain("seek")
    expect(r.clock.time).toBeCloseTo(19.5, 5)
  })

  it("обычный шаг reported (и шум < 50 мс назад) — не seek", () => {
    let c = tick(initialClock(), { now: 0, reported: 20, state: "playing", rate: 1 }).clock
    c = tick(c, { now: 250, reported: 20.25, state: "playing", rate: 1 }).clock
    const r = tick(c, { now: 500, reported: 20.23, state: "playing", rate: 1 })
    expect(r.events.map((e) => e.kind)).not.toContain("seek")
  })
})

describe("playback rate", () => {
  it.each([0.5, 1.5, 2])("скорость %s: interpolated ≈ видео", (rate) => {
    const { clock, video, events } = run([{ ms: 4000, rate }])
    expect(Math.abs(clock.time - video)).toBeLessThan(0.3 * rate)
    expect(events.some((e) => e.kind === "seek")).toBe(false)
  })

  it("смена скорости на лету без seek и без рывка назад", () => {
    const { events, samples } = run([{ ms: 2000, rate: 1 }, { ms: 2000, rate: 1.5 }, { ms: 2000, rate: 0.5 }])
    expect(events.some((e) => e.kind === "seek")).toBe(false)
    const backsteps = samples.filter((s, i) => i > 0 && s.time < samples[i - 1].time - 0.15)
    expect(backsteps).toHaveLength(0)
  })
})

describe("findActiveIndex", () => {
  const starts = [0, 2.5, 5, 10, 10, 30]
  it.each([
    [-1, -1],
    [0, 0],
    [2.49, 0],
    [2.5, 1],
    [9.99, 2],
    [10, 4],
    [29, 4],
    [1000, 5]
  ])("t=%s → %s", (t, idx) => {
    expect(findActiveIndex(starts, t)).toBe(idx)
  })
  it("пустой список", () => expect(findActiveIndex([], 5)).toBe(-1))
})
