// Профиль: ключи AI-провайдеров (хранятся на сервере, шифрованные) + провайдер/модель по задачам.
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"
import {
  CheckCircledIcon,
  CrossCircledIcon,
  ExternalLinkIcon,
  QuestionMarkCircledIcon,
  ReloadIcon
} from "@radix-ui/react-icons"
import type { Session } from "@supabase/supabase-js"
import { useCallback, useEffect, useState } from "react"

import {
  ApiError,
  deleteProviderKey,
  deleteTranscriptKey,
  fetchAiProviders,
  fetchAiSettings,
  fetchModels,
  saveAiSetting,
  saveProviderKey,
  saveTranscriptKey,
  testProviderKey,
  testTranscriptKey,
  type AiModel,
  type AiProvider,
  type AiTask,
  type CredentialStatus,
  type TaskSetting,
  type TranscriptProviderInfo
} from "../api"
import { signOut } from "../auth"
import { LoginCard } from "./LoginCard"
import { ModelPicker } from "./ModelPicker"

const TASKS: { id: AiTask; label: string; hint: string }[] = [
  { id: "chat", label: "Чат", hint: "вопросы по видео" },
  { id: "summary", label: "Саммари", hint: "краткое содержание и слова" },
  { id: "translate", label: "Перевод", hint: "перевод транскрипта (скоро)" }
]

const errText = (e: unknown) => (e instanceof Error ? e.message : "Ошибка")

type TranscriptProps = {
  transcriptProviders: TranscriptProviderInfo[]
  transcriptChoice: string
  onTranscriptChoice: (id: string) => void
  onTranscriptProvidersChanged: () => void
}

type ProfileTab = "models" | "providers" | "transcripts"
const TAB_KEY = "scribeowl.profileTab"

function readTab(): ProfileTab {
  try {
    const v = JSON.parse(localStorage.getItem(TAB_KEY) || "null")
    return v === "providers" || v === "transcripts" ? v : "models"
  } catch {
    return "models"
  }
}

export function ProfilePage({
  session,
  onBack,
  ...transcript
}: { session: Session | null; onBack: () => void } & TranscriptProps) {
  if (!session) return <LoginCard />
  return (
    <ProfileContent email={session.user.email ?? ""} onBack={onBack} {...transcript} />
  )
}

function ProfileContent({
  email,
  onBack,
  ...transcript
}: { email: string; onBack: () => void } & TranscriptProps) {
  const [tab, setTab] = useState<ProfileTab>(readTab)
  useEffect(() => {
    try {
      localStorage.setItem(TAB_KEY, JSON.stringify(tab))
    } catch {
      /* private mode */
    }
  }, [tab])
  const [providers, setProviders] = useState<AiProvider[]>([])
  const [settings, setSettings] = useState<TaskSetting[]>([])
  const [error, setError] = useState("")

  const reload = useCallback(async () => {
    try {
      const [p, s] = await Promise.all([fetchAiProviders(), fetchAiSettings()])
      setProviders(p)
      setSettings(s)
      setError("")
    } catch (e) {
      setError(errText(e))
    }
  }, [])
  useEffect(() => {
    reload()
  }, [reload])

  const configured = providers.filter((p) => p.credential.configured)

  return (
    <div className="grid gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
      <aside className="grid content-start gap-4 rounded-lg border bg-muted p-6">
        <h1 className="text-2xl font-semibold">Профиль</h1>
        <p className="break-all text-sm text-muted-foreground">{email}</p>
        <p className="text-sm text-muted-foreground">
          Ключи хранятся на сервере в зашифрованном виде (AES-256-GCM). Браузер видит
          только последние 4 символа.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={onBack}>
            К плееру
          </Button>
          <Button type="button" variant="ghost" onClick={() => signOut()}>
            Выйти
          </Button>
        </div>
      </aside>

      <div className="grid min-w-0 content-start gap-4">
        {error ? (
          <p className="rounded-md border border-destructive p-3 text-sm text-destructive">
            {error}
          </p>
        ) : null}

        <Tabs
          value={tab}
          onValueChange={(v) => setTab(v as ProfileTab)}
          className="grid gap-4">
          <TabsList className="grid h-auto w-full grid-cols-3">
            <TabsTrigger value="models">Модели по задачам</TabsTrigger>
            <TabsTrigger value="providers">
              AI-провайдеры
              {configured.length ? (
                <span className="ml-2 rounded bg-muted px-1.5 text-xs text-muted-foreground">
                  {configured.length}
                </span>
              ) : null}
            </TabsTrigger>
            <TabsTrigger value="transcripts">Транскрипты</TabsTrigger>
          </TabsList>

          <TabsContent value="models" className="mt-0">
            <Card>
              <CardHeader>
                <CardTitle>Модели по задачам</CardTitle>
                <CardDescription>
                  Список моделей берётся из API провайдера по вашему ключу.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4">
                {configured.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Сначала добавьте ключ хотя бы одного провайдера во вкладке
                    «AI-провайдеры».
                  </p>
                ) : (
                  TASKS.map((task) => (
                    <TaskRow
                      key={task.id}
                      task={task}
                      providers={configured}
                      setting={settings.find((s) => s.task === task.id)}
                      onSaved={(s) =>
                        setSettings((all) => [...all.filter((x) => x.task !== s.task), s])
                      }
                    />
                  ))
                )}
              </CardContent>
            </Card>
            {configured.length === 0 ? (
              <Button
                type="button"
                variant="outline"
                className="mt-3"
                onClick={() => setTab("providers")}>
                Добавить ключ провайдера
              </Button>
            ) : null}
          </TabsContent>

          <TabsContent value="providers" className="mt-0">
            <Card>
              <CardHeader>
                <CardTitle>AI-провайдеры</CardTitle>
                <CardDescription>
                  Ключ проверяется сразу после сохранения (бесплатный запрос списка
                  моделей).
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3">
                {providers.map((p) => (
                  <ProviderRow key={p.id} provider={p} onChanged={reload} />
                ))}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="transcripts" className="mt-0">
            <TranscriptSettings {...transcript} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}

function StatusBadge({
  credential
}: {
  credential: CredentialStatus | null | undefined
}) {
  const c = credential
  if (!c?.configured)
    return <span className="text-xs text-muted-foreground">ключ не добавлен</span>
  const ok = c.status === "valid"
  const bad = c.status === "invalid"
  const Icon = ok ? CheckCircledIcon : bad ? CrossCircledIcon : QuestionMarkCircledIcon
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs",
        ok ? "text-green-700" : bad ? "text-destructive" : "text-muted-foreground"
      )}>
      <Icon />
      ••••{c.key_hint} · {ok ? "работает" : bad ? "ключ не принят" : "не проверен"}
    </span>
  )
}

type KeyResult = {
  ok: boolean
  models_count?: number | null
  error: { message: string } | null
}
type KeyActions = {
  save: (key: string) => Promise<KeyResult>
  test: () => Promise<KeyResult>
  remove: () => Promise<void>
}

/** Ключ провайдера: нет ключа — поле + «Сохранить»; есть — маска, «Изменить», «Проверить», «Удалить». */
function KeyRow({
  name,
  keysUrl,
  docsUrl,
  credential,
  note,
  actions,
  onChanged
}: {
  name: string
  keysUrl?: string | null
  docsUrl?: string | null
  credential: CredentialStatus | null | undefined
  note?: string
  actions: KeyActions
  onChanged: () => void
}) {
  const configured = Boolean(credential?.configured)
  const [editing, setEditing] = useState(false)
  const [key, setKey] = useState("")
  const [busy, setBusy] = useState<"" | "save" | "test" | "delete">("")
  const [message, setMessage] = useState("")
  const showInput = !configured || editing

  const describe = (r: KeyResult) =>
    r.ok
      ? `Ключ работает${r.models_count != null ? ` · моделей: ${r.models_count}` : ""}`
      : `Ошибка: ${r.error?.message}`

  async function run(kind: "save" | "test" | "delete") {
    setBusy(kind)
    setMessage("")
    try {
      if (kind === "delete") {
        await actions.remove()
        setMessage("Ключ удалён")
      } else if (kind === "save") {
        setMessage(describe(await actions.save(key.trim())))
        setKey("")
        setEditing(false)
      } else {
        setMessage(describe(await actions.test()))
      }
      onChanged()
    } catch (e) {
      setMessage(`Ошибка: ${errText(e)}`)
    } finally {
      setBusy("")
    }
  }

  const link =
    "inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
  return (
    <div className="grid gap-3 rounded-md border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-semibold">{name}</span>
          <StatusBadge credential={credential} />
        </div>
        <div className="flex items-center gap-3">
          {docsUrl ? (
            <a href={docsUrl} target="_blank" rel="noreferrer" className={link}>
              Документация <ExternalLinkIcon />
            </a>
          ) : null}
          {keysUrl ? (
            <a href={keysUrl} target="_blank" rel="noreferrer" className={link}>
              Где взять ключ <ExternalLinkIcon />
            </a>
          ) : null}
        </div>
      </div>
      {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
      {credential?.status === "invalid" && credential.last_error && !editing ? (
        <p className="text-xs text-destructive">{credential.last_error}</p>
      ) : null}

      {showInput ? (
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (key.trim().length >= 8) run("save")
          }}>
          <Input
            type="password"
            autoComplete="off"
            autoFocus={editing}
            placeholder={configured ? "Новый ключ (заменит текущий)" : "API-ключ"}
            value={key}
            onChange={(e) => setKey(e.target.value)}
            className="min-w-[220px] flex-1"
          />
          <Button type="submit" disabled={busy !== "" || key.trim().length < 8}>
            {busy === "save" ? "Проверяю..." : "Сохранить"}
          </Button>
          {editing ? (
            <Button
              type="button"
              variant="ghost"
              disabled={busy !== ""}
              onClick={() => {
                setEditing(false)
                setKey("")
              }}>
              Отмена
            </Button>
          ) : null}
        </form>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={busy !== ""}
            onClick={() => setEditing(true)}>
            Изменить
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={busy !== ""}
            onClick={() => run("test")}>
            {busy === "test" ? "Проверяю..." : "Проверить"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={busy !== ""}
            onClick={() => run("delete")}>
            {busy === "delete" ? "..." : "Удалить"}
          </Button>
        </div>
      )}
      {message ? <p className="text-xs text-muted-foreground">{message}</p> : null}
    </div>
  )
}

function ProviderRow({
  provider,
  onChanged
}: {
  provider: AiProvider
  onChanged: () => void
}) {
  return (
    <KeyRow
      name={provider.name}
      keysUrl={provider.keys_url}
      credential={provider.credential}
      onChanged={onChanged}
      actions={{
        save: (key) => saveProviderKey(provider.id, key),
        test: () => testProviderKey(provider.id),
        remove: () => deleteProviderKey(provider.id)
      }}
    />
  )
}

function TaskRow({
  task,
  providers,
  setting,
  onSaved
}: {
  task: { id: AiTask; label: string; hint: string }
  providers: AiProvider[]
  setting?: TaskSetting
  onSaved: (s: TaskSetting) => void
}) {
  const [providerId, setProviderId] = useState(
    setting?.provider_id ?? providers[0]?.id ?? ""
  )
  const [modelId, setModelId] = useState(setting?.model_id ?? "")
  const [models, setModels] = useState<AiModel[]>([])
  const [state, setState] = useState<"" | "loading" | "saving">("")
  const [message, setMessage] = useState("")

  useEffect(() => {
    if (setting) {
      setProviderId(setting.provider_id)
      setModelId(setting.model_id)
    }
  }, [setting?.provider_id, setting?.model_id])

  const loadModels = useCallback(
    async (refresh = false) => {
      if (!providerId) return
      setState("loading")
      setMessage("")
      try {
        setModels(await fetchModels(providerId, refresh))
      } catch (e) {
        setModels([])
        setMessage(e instanceof ApiError ? e.message : errText(e))
      } finally {
        setState("")
      }
    },
    [providerId]
  )
  useEffect(() => {
    loadModels()
  }, [loadModels])

  const provider = providers.find((p) => p.id === providerId)
  const current = models.find((m) => m.id === modelId)
  const dirty =
    !setting || setting.provider_id !== providerId || setting.model_id !== modelId

  async function save() {
    setState("saving")
    setMessage("Проверяю модель пробным запросом...")
    try {
      const { warning, ...saved } = await saveAiSetting(
        task.id,
        providerId,
        modelId.trim()
      )
      onSaved(saved)
      setMessage(warning ?? "Сохранено · модель ответила на пробный запрос")
    } catch (e) {
      setMessage(`Ошибка: ${errText(e)}`)
    } finally {
      setState("")
    }
  }

  return (
    <div className="grid gap-2 rounded-md border p-4">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-semibold">{task.label}</span>
        <span className="text-xs text-muted-foreground">{task.hint}</span>
      </div>
      <div className="grid gap-2 md:grid-cols-[200px_minmax(0,1fr)_auto_auto]">
        <Select
          value={providerId}
          onValueChange={(v) => {
            setProviderId(v)
            setModelId("")
          }}>
          <SelectTrigger aria-label={`Провайдер: ${task.label}`}>
            <SelectValue placeholder="Провайдер" />
          </SelectTrigger>
          <SelectContent>
            {providers.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <ModelPicker
          label={`Модель: ${task.label}`}
          models={models}
          value={modelId}
          onChange={setModelId}
          loading={state === "loading"}
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          title="Обновить список моделей"
          onClick={() => loadModels(true)}>
          <ReloadIcon className={cn(state === "loading" && "animate-spin")} />
        </Button>
        <Button
          type="button"
          disabled={!modelId.trim() || !dirty || state !== ""}
          onClick={save}>
          {state === "saving" ? "..." : "Сохранить"}
        </Button>
      </div>
      {provider &&
      !models.length &&
      state !== "loading" &&
      provider.default_models.length ? (
        <p className="text-xs text-muted-foreground">
          Например: {provider.default_models.join(", ")}
        </p>
      ) : null}
      {modelId && models.length > 0 && !current && state === "" ? (
        <p className="text-xs text-destructive">
          Модель «{modelId}» недоступна для вашего аккаунта или устарела — выберите другую
          из списка.
        </p>
      ) : null}
      {current?.note && current.status !== "stable" ? (
        <p className="text-xs text-amber-700">{current.note}</p>
      ) : null}
      {message ? <p className="text-xs text-muted-foreground">{message}</p> : null}
    </div>
  )
}

function TranscriptSettings({
  transcriptProviders,
  transcriptChoice,
  onTranscriptChoice,
  onTranscriptProvidersChanged
}: TranscriptProps) {
  const order = transcriptProviders.filter((p) => p.configured)
  const keyed = transcriptProviders.filter((p) => p.requires_api_key)
  const status = (p: TranscriptProviderInfo) =>
    !p.configured
      ? "нет ключа"
      : p.key_source === "user"
        ? "ваш ключ"
        : p.key_source === "server"
          ? "ключ сервера"
          : "доступен"
  const options = [
    {
      id: "auto",
      name: "Авто",
      hint: order.length
        ? `По порядку с фолбэком: ${order.map((p) => p.name).join(" → ")}. Следующий пробуется при лимите, сетевой ошибке или проблеме с ключом; если у видео нет субтитров — только сервисы, которые распознают речь.`
        : "Нет доступных сервисов транскрипции.",
      configured: order.length > 0,
      label: order.length ? "доступен" : "не настроен",
      docs_url: null as string | null
    },
    ...transcriptProviders.map((p) => ({
      id: p.id,
      name: p.name,
      hint: [
        p.pricing,
        p.requires_api_key
          ? [
              p.timed
                ? "Точное время фраз."
                : "Без времени фраз — подсветка приблизительная (≈).",
              p.can_generate ? "Распознаёт речь, если у видео нет субтитров." : null
            ]
              .filter(Boolean)
              .join(" ")
          : null,
        p.requires_api_key
          ? p.key_source === "user"
            ? "Используется ваш ключ."
            : p.key_source === "server"
              ? "Используется ключ сервера — можно добавить свой ниже."
              : "Добавьте ключ ниже."
          : null
      ]
        .filter(Boolean)
        .join(" "),
      configured: p.configured,
      label: status(p),
      docs_url: p.docs_url
    }))
  ]

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Сервис транскрипции</CardTitle>
          <CardDescription>
            Откуда брать текст видео. Этот же выбор стоит в панели «Транскрипт» у плеера.
          </CardDescription>
        </CardHeader>
        <CardContent
          className="grid gap-3"
          role="radiogroup"
          aria-label="Сервис транскрипции">
          {transcriptProviders.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Сервер не вернул список провайдеров транскриптов.
            </p>
          ) : null}
          {options.map((o) => {
            const active = transcriptChoice === o.id
            return (
              <button
                key={o.id}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={!o.configured}
                onClick={() => onTranscriptChoice(o.id)}
                className={cn(
                  "grid gap-1 rounded-md border p-4 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60",
                  active ? "border-primary ring-1 ring-primary" : "hover:bg-accent"
                )}>
                <span className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex items-center gap-2 font-semibold">
                    <span
                      className={cn(
                        "inline-block h-3.5 w-3.5 rounded-full border",
                        active ? "border-4 border-primary" : "border-muted-foreground/50"
                      )}
                    />
                    {o.name}
                  </span>
                  <span
                    className={cn(
                      "text-xs",
                      o.configured ? "text-green-700" : "text-muted-foreground"
                    )}>
                    {o.label}
                  </span>
                </span>
                <span className="text-sm text-muted-foreground">{o.hint}</span>
                {o.docs_url ? (
                  <a
                    href={o.docs_url}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="inline-flex w-fit items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                    Документация <ExternalLinkIcon />
                  </a>
                ) : null}
              </button>
            )
          })}
        </CardContent>
      </Card>

      {keyed.length ? (
        <Card>
          <CardHeader>
            <CardTitle>Ключи сервисов транскрипции</CardTitle>
            <CardDescription>
              Хранятся на сервере в зашифрованном виде. Ключ проверяется сразу после
              сохранения бесплатным запросом (кредиты не тратит).
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {keyed.map((p) => (
              <KeyRow
                key={p.id}
                name={p.name}
                keysUrl={p.keys_url}
                docsUrl={p.docs_url}
                credential={p.credential}
                note={
                  p.key_source === "server" && !p.credential
                    ? "Сейчас работает ключ сервера. Ваш ключ будет использоваться вместо него."
                    : undefined
                }
                onChanged={onTranscriptProvidersChanged}
                actions={{
                  save: (key) => saveTranscriptKey(p.id, key),
                  test: () => testTranscriptKey(p.id),
                  remove: () => deleteTranscriptKey(p.id)
                }}
              />
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}
