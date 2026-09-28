import { describe, expect, it } from "vitest"

import { buildTimedTranscript, formatClock, linkifyTimestamps, parseClock, seekTarget } from "./timestamps"

describe("clock", () => {
  it("format/parse", () => {
    expect(formatClock(3)).toBe("0:03")
    expect(formatClock(83.9)).toBe("1:23")
    expect(formatClock(3725)).toBe("1:02:05")
    expect(parseClock("1:23")).toBe(83)
    expect(parseClock("01:02:05")).toBe(3725)
    expect(parseClock("1:75")).toBeNull()
  })
})

describe("buildTimedTranscript", () => {
  it("группирует сегменты в блоки с метками", () => {
    const segs = Array.from({ length: 12 }, (_, i) => ({ start: i * 5, text: `s${i}` }))
    const out = buildTimedTranscript(segs, "fallback").split("\n")
    expect(out[0]).toBe("[0:00] s0 s1 s2 s3")
    expect(out[1]).toBe("[0:20] s4 s5 s6 s7")
    expect(out).toHaveLength(3)
  })
  it("без сегментов — исходный текст", () => {
    expect(buildTimedTranscript([], "plain")).toBe("plain")
  })
})

describe("linkifyTimestamps", () => {
  it("метки и диапазоны → ссылки", () => {
    expect(linkifyTimestamps("Круг **49.6 с** [4:12], старт [1:02:05].")).toBe(
      "Круг **49.6 с** [4:12](#t=252), старт [1:02:05](#t=3725)."
    )
    expect(linkifyTimestamps("см. [1:20–1:45]")).toBe("см. [1:20–1:45](#t=80)")
  })
  it("не трогает готовые ссылки, мусор и время за пределами видео", () => {
    expect(linkifyTimestamps("[1:23](#t=83)")).toBe("[1:23](#t=83)")
    expect(linkifyTimestamps("[99:99] и [текст]")).toBe("[99:99] и [текст]")
    expect(linkifyTimestamps("[20:00]", 600)).toBe("[20:00]")
  })
  it("seekTarget", () => {
    expect(seekTarget("#t=83")).toBe(83)
    expect(seekTarget("https://x.y")).toBeNull()
  })
})
