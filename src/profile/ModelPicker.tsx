// Выпадающий список моделей: кнопка с текущей моделью → панель с поиском и ПОЛНЫМ списком.
// Поиск — отдельная строка внутри панели, выбранное значение список не фильтрует.
import { CheckIcon, ChevronDownIcon, MagnifyingGlassIcon } from "@radix-ui/react-icons"
import { useEffect, useMemo, useRef, useState } from "react"

import { cn } from "@/lib/utils"

import type { AiModel } from "../api"

const GROUPS: { key: string; label: string; test: (m: AiModel) => boolean }[] = [
  { key: "recommended", label: "Рекомендуемые", test: (m) => m.recommended },
  { key: "stable", label: "Стабильные", test: (m) => !m.recommended && m.status === "stable" },
  { key: "preview", label: "Preview", test: (m) => m.status === "preview" },
  { key: "deprecated", label: "Устаревающие", test: (m) => m.status === "deprecated" }
]

const ctx = (m: AiModel) => (m.context_window ? `${Math.round(m.context_window / 1000)}k` : "")

export function ModelPicker({
  models,
  value,
  onChange,
  loading,
  disabled,
  label
}: {
  models: AiModel[]
  value: string
  onChange: (id: string) => void
  loading?: boolean
  disabled?: boolean
  label: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [cursor, setCursor] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const selected = models.find((m) => m.id === value)
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const hits = q ? models.filter((m) => `${m.id} ${m.display_name}`.toLowerCase().includes(q)) : models
    return GROUPS.flatMap((g) => hits.filter(g.test).map((m) => ({ m, group: g.label })))
  }, [models, query])

  useEffect(() => {
    if (!open) return
    setQuery("")
    const i = filtered.findIndex((x) => x.m.id === value)
    setCursor(i >= 0 ? i : 0)
    window.requestAnimationFrame(() => searchRef.current?.focus())
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onDown)
    return () => document.removeEventListener("mousedown", onDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${cursor}"]`)?.scrollIntoView({ block: "nearest" })
  }, [cursor, open])

  function pick(id: string) {
    onChange(id)
    setOpen(false)
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault()
      setCursor((c) => Math.min(c + 1, filtered.length - 1))
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setCursor((c) => Math.max(c - 1, 0))
    } else if (e.key === "Enter") {
      e.preventDefault()
      if (filtered[cursor]) pick(filtered[cursor].m.id)
    } else if (e.key === "Escape") {
      setOpen(false)
    }
  }

  const buttonText = loading
    ? "Загружаю модели..."
    : selected
      ? selected.display_name
      : value || (models.length ? `Выберите модель (${models.length})` : "Нет доступных моделей")

  return (
    <div ref={rootRef} className="relative min-w-0">
      <button
        type="button"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled || loading || !models.length}
        onClick={() => setOpen((o) => !o)}
        className="flex h-10 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 text-left text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50">
        <span className="min-w-0 truncate">
          {buttonText}
          {selected && selected.display_name !== selected.id ? (
            <span className="ml-2 text-xs text-muted-foreground">{selected.id}</span>
          ) : null}
        </span>
        <ChevronDownIcon className="shrink-0 opacity-50" />
      </button>

      {open ? (
        <div className="absolute left-0 right-0 top-11 z-30 rounded-md border bg-popover text-popover-foreground shadow-md">
          <div className="flex items-center gap-2 border-b px-3">
            <MagnifyingGlassIcon className="shrink-0 opacity-50" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setCursor(0)
              }}
              onKeyDown={onKey}
              placeholder={`Поиск среди ${models.length} моделей`}
              className="h-10 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
          <div ref={listRef} role="listbox" className="max-h-80 overflow-auto p-1">
            {filtered.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">Ничего не найдено</p>
            ) : (
              filtered.map(({ m, group }, i) => (
                <div key={m.id}>
                  {i === 0 || filtered[i - 1].group !== group ? (
                    <div className="px-2 pb-1 pt-2 text-xs font-medium text-muted-foreground">{group}</div>
                  ) : null}
                  <div
                    role="option"
                    aria-selected={m.id === value}
                    data-index={i}
                    onMouseEnter={() => setCursor(i)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pick(m.id)}
                    className={cn(
                      "flex cursor-pointer items-start gap-2 rounded-sm px-2 py-1.5 text-sm",
                      i === cursor && "bg-accent text-accent-foreground"
                    )}>
                    <CheckIcon className={cn("mt-0.5 shrink-0", m.id === value ? "opacity-100" : "opacity-0")} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{m.display_name}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {m.id}
                        {ctx(m) ? ` · ${ctx(m)}` : ""}
                        {m.note ? ` · ${m.note}` : ""}
                      </span>
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}
