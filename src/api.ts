// Клиент нашего API (FastAPI, server/). Ключи провайдеров сюда не попадают (только маска).
import { accessToken } from "./auth"

export const API_URL = (import.meta.env.VITE_API_URL || "http://127.0.0.1:8000").replace(/\/$/, "")

export type TranscriptSegmentDto = { start: number; end: number; text: string; approximate: boolean }

export type TranscriptDto = {
  video_id: string
  language: string
  title: string | null
  duration: number | null
  available_languages: string[]
  provider_id: string
  segments: TranscriptSegmentDto[]
  /** false — провайдер не дал времени фраз, только text */
  timed?: boolean
  text?: string | null
}

export type TranscriptProviderInfo = {
  id: string
  name: string
  requires_api_key: boolean
  configured: boolean
  docs_url: string
  keys_url: string | null
  /** откуда ключ: user — профиль пользователя, server — env сервера */
  key_source: "user" | "server" | null
  credential: CredentialStatus | null
  can_generate: boolean
  timed: boolean
  pricing: string | null
}

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public providerId: string | null,
    public status: number
  ) {
    super(message)
  }
}

async function authHeaders(): Promise<Record<string, string>> {
  const token = await accessToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...(await authHeaders()),
        ...(init?.headers || {})
      }
    })
  } catch {
    throw new ApiError("network", `Сервер ${API_URL} недоступен`, null, 0)
  }
  const data = await response.json().catch(() => ({}))
  if (response.status === 204) return undefined as T
  if (!response.ok) {
    const message = data.message || (typeof data.detail === "string" ? data.detail : null) || `HTTP ${response.status}`
    throw new ApiError(data.code || "error", message, data.provider_id ?? null, response.status)
  }
  return data as T
}

export const fetchTranscriptProviders = () => call<TranscriptProviderInfo[]>("/transcripts/providers")

export const fetchTranscript = (body: { url?: string; video_id?: string; language?: string; provider_id?: string }) =>
  call<TranscriptDto>("/transcripts", { method: "POST", body: JSON.stringify(body) })

// ---------- AI-провайдеры (ключи только на сервере, наружу — маска и статус) ----------
export type AiTask = "translate" | "chat" | "summary"

export type CredentialStatus = {
  provider_id: string
  configured: boolean
  key_hint: string | null
  status: "unverified" | "valid" | "invalid" | null
  last_checked_at: string | null
  last_error: string | null
}

export type AiProvider = {
  id: string
  name: string
  capabilities: AiTask[]
  docs_url: string
  keys_url: string
  default_models: string[]
  credential: CredentialStatus
}

export type AiModel = {
  id: string
  provider_id: string
  display_name: string
  context_window: number | null
  status: "stable" | "preview" | "deprecated"
  recommended: boolean
  note: string | null
}

export type TestResult = {
  ok: boolean
  models_count: number | null
  credential: CredentialStatus
  error: { code: string; message: string } | null
}

export type TaskSetting = { task: AiTask; provider_id: string; model_id: string; params: Record<string, unknown> }

export const fetchAiProviders = () => call<AiProvider[]>("/providers")
export const saveProviderKey = (id: string, apiKey: string) =>
  call<TestResult>(`/providers/${id}/credentials`, { method: "PUT", body: JSON.stringify({ api_key: apiKey }) })
export const deleteProviderKey = (id: string) => call<void>(`/providers/${id}/credentials`, { method: "DELETE" })
export const testProviderKey = (id: string) => call<TestResult>(`/providers/${id}/test`, { method: "POST" })
export const fetchModels = (id: string, refresh = false) =>
  call<AiModel[]>(`/providers/${id}/models${refresh ? "?refresh=true" : ""}`)
export const fetchAiSettings = () => call<TaskSetting[]>("/settings/ai")
/** Сервер делает пробный запрос к модели: недоступную модель не сохранит (ошибка), при лимите — warning. */
export const saveAiSetting = (task: AiTask, providerId: string, modelId: string) =>
  call<TaskSetting & { warning: string | null }>(`/settings/ai/${task}`, {
    method: "PUT",
    body: JSON.stringify({ provider_id: providerId, model_id: modelId })
  })

export type StreamRequest = {
  task: "chat" | "summary"
  title?: string
  transcript: string
  messages?: { role: "user" | "assistant"; content: string }[]
}

/** POST /ai/stream (SSE): onDelta на каждый кусок текста, промис резолвится полным текстом. */
export async function streamAi(
  body: StreamRequest,
  onDelta: (text: string) => void,
  signal?: AbortSignal
): Promise<{ text: string; providerId?: string; modelId?: string }> {
  let response: Response
  try {
    response = await fetch(`${API_URL}/ai/stream`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(await authHeaders()) },
      body: JSON.stringify(body),
      signal
    })
  } catch {
    throw new ApiError("network", `Сервер ${API_URL} недоступен`, null, 0)
  }
  if (!response.ok || !response.body) {
    const data = await response.json().catch(() => ({}))
    throw new ApiError(data.code || "error", data.message || data.detail || `HTTP ${response.status}`, data.provider_id ?? null, response.status)
  }
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ""
  let text = ""
  let meta: { providerId?: string; modelId?: string } = {}
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += value
    let sep: number
    while ((sep = buffer.indexOf("\n\n")) >= 0) {
      const raw = buffer.slice(0, sep)
      buffer = buffer.slice(sep + 2)
      const event = raw.match(/^event: (.*)$/m)?.[1]
      const dataLine = raw.match(/^data: (.*)$/m)?.[1]
      if (!dataLine) continue
      const data = JSON.parse(dataLine)
      if (event === "start") meta = { providerId: data.provider_id, modelId: data.model_id }
      else if (event === "delta") {
        text += data.text
        onDelta(data.text)
      } else if (event === "error") throw new ApiError(data.code, data.message, data.provider_id ?? null, 200)
    }
  }
  return { text, ...meta }
}

// ---------- ключи транскрипт-провайдеров (transcriptapi) ----------
export type KeyTestResult = {
  ok: boolean
  credential: CredentialStatus | null
  error: { code: string; message: string } | null
}
export const saveTranscriptKey = (id: string, apiKey: string) =>
  call<KeyTestResult>(`/transcripts/providers/${id}/credentials`, {
    method: "PUT",
    body: JSON.stringify({ api_key: apiKey })
  })
export const testTranscriptKey = (id: string) =>
  call<KeyTestResult>(`/transcripts/providers/${id}/test`, { method: "POST" })
export const deleteTranscriptKey = (id: string) =>
  call<void>(`/transcripts/providers/${id}/credentials`, { method: "DELETE" })

// ---------- перевод фраз (пачка) ----------
export type TranslateResult = {
  items: { i: number; text: string }[]
  missing: number[]
  provider_id: string
  model_id: string
}
export const translateBatch = (
  body: { target_language: string; title?: string; segments: { i: number; text: string }[] },
  signal?: AbortSignal
) => call<TranslateResult>("/ai/translate", { method: "POST", body: JSON.stringify(body), signal })
