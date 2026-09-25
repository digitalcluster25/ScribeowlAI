import { describe, expect, it } from "vitest"

import { planBatches } from "./batches"

const texts = Array.from({ length: 10 }, (_, i) => `t${i}`)

describe("planBatches", () => {
  it("с текущей фразы вперёд, потом с начала; лимит на пачку", () => {
    const b = planBatches(texts, [], 6, 3)
    expect(b.map((x) => x.map((y) => y.i))).toEqual([[6, 7, 8], [9], [0, 1, 2], [3, 4, 5]])
  })
  it("пропускает уже переведённые и пустые, режет по разрывам", () => {
    const done: (string | null)[] = []
    done[2] = "x"
    const t = [...texts]
    t[4] = "  "
    const b = planBatches(t, done, 0, 10)
    expect(b.map((x) => x.map((y) => y.i))).toEqual([[0, 1], [3], [5, 6, 7, 8, 9]])
  })
  it("лимит символов", () => {
    const long = ["a".repeat(2000), "b".repeat(2000), "c"]
    expect(planBatches(long, [], 0, 60, 3000).map((x) => x.length)).toEqual([1, 2])
  })
  it("пусто", () => expect(planBatches([], [], 0)).toEqual([]))
})
