// Разбиение фраз на пачки для перевода: сначала от текущей фразы вперёд, потом с начала.
export type Item = { i: number; text: string }

export function planBatches(
  texts: string[],
  done: ReadonlyArray<string | null | undefined>,
  startAt: number,
  maxItems = 60,
  maxChars = 3000
): Item[][] {
  const n = texts.length
  const start = Math.min(Math.max(0, startAt), Math.max(0, n - 1))
  const order = [...Array.from({ length: n - start }, (_, k) => start + k), ...Array.from({ length: start }, (_, k) => k)]
  const batches: Item[][] = []
  let cur: Item[] = []
  let chars = 0
  let prev = -2
  for (const i of order) {
    if (done[i] || !texts[i]?.trim()) continue
    const text = texts[i].trim().slice(0, 2000)
    // новая пачка: лимиты или разрыв последовательности (соседние фразы — контекст для модели)
    if (cur.length && (cur.length >= maxItems || chars + text.length > maxChars || i !== prev + 1)) {
      batches.push(cur)
      cur = []
      chars = 0
    }
    cur.push({ i, text })
    chars += text.length
    prev = i
  }
  if (cur.length) batches.push(cur)
  return batches
}
