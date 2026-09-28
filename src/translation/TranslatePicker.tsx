// Кнопка «Перевод» → панель: поиск, список языков, «Без перевода», ОК / Отмена.
import { CheckIcon, MagnifyingGlassIcon } from "@radix-ui/react-icons"
import { useEffect, useMemo, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

import { LANGUAGES } from "./languages"

const NONE = "__none__"

function TranslateIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className={className} aria-hidden>
      <path d="M4 5h9M8.5 3v2M6 5c.6 3.2 2.8 5.7 5.5 7M11 5c-.6 3-2.6 5.8-6.5 7.5" strokeLinecap="round" />
      <path d="M12.5 21l4-9 4 9M13.8 18h5.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function TranslatePicker({
  value,
  busy,
  onConfirm
}: {
  value: string | null
  busy?: boolean
  onConfirm: (code: string | null) => void
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<string>(value ?? "ru")
  const [query, setQuery] = useState("")
  const rootRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setDraft(value ?? "ru")
    setQuery("")
    window.requestAnimationFrame(() => searchRef.current?.focus())
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onDown)
    return () => document.removeEventListener("mousedown", onDown)
  }, [open, value])

  const list = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? LANGUAGES.filter((l) => `${l.label} ${l.native} ${l.code}`.toLowerCase().includes(q)) : LANGUAGES
  }, [query])

  function confirm() {
    onConfirm(draft === NONE ? null : draft)
    setOpen(false)
  }

  return (
    <div ref={rootRef} className="relative">
      <Button
        type="button"
        variant={value ? "default" : "outline"}
        size={value ? "default" : "icon"}
        title={value ? "Перевод включён — сменить язык" : "Перевести транскрипт"}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn(value && "gap-1.5 px-3")}>
        <TranslateIcon className={cn("h-4 w-4", busy && "animate-pulse")} />
        {value ? <span className="text-xs font-semibold uppercase">{value}</span> : null}
      </Button>

      {open ? (
        <div
          role="dialog"
          aria-label="Язык перевода"
          className="absolute right-0 top-11 z-30 w-72 rounded-md border bg-popover text-popover-foreground shadow-md">
          <div className="border-b px-3 py-2 text-sm font-semibold">Перевести на</div>
          <div className="flex items-center gap-2 border-b px-3">
            <MagnifyingGlassIcon className="shrink-0 opacity-50" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  if (list.length === 1) setDraft(list[0].code)
                  else confirm()
                }
                if (e.key === "Escape") setOpen(false)
              }}
              placeholder="Найти язык"
              className="h-9 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
          <div role="radiogroup" className="max-h-64 overflow-auto p-1">
            {value && !query ? (
              <Option active={draft === NONE} onClick={() => setDraft(NONE)} label="Без перевода" hint="скрыть перевод" />
            ) : null}
            {list.map((l) => (
              <Option
                key={l.code}
                active={draft === l.code}
                onClick={() => setDraft(l.code)}
                onDoubleClick={() => {
                  setDraft(l.code)
                  onConfirm(l.code)
                  setOpen(false)
                }}
                label={l.label}
                hint={l.native !== l.label ? l.native : undefined}
              />
            ))}
            {list.length === 0 ? <p className="px-3 py-4 text-center text-sm text-muted-foreground">Не найдено</p> : null}
          </div>
          <div className="flex justify-end gap-2 border-t p-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Отмена
            </Button>
            <Button type="button" size="sm" onClick={confirm}>
              ОК
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function Option({
  active,
  label,
  hint,
  onClick,
  onDoubleClick
}: {
  active: boolean
  label: string
  hint?: string
  onClick: () => void
  onDoubleClick?: () => void
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent",
        active && "bg-accent"
      )}>
      <CheckIcon className={cn("shrink-0", active ? "opacity-100" : "opacity-0")} />
      <span className="flex-1">{label}</span>
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </button>
  )
}
