import { randomUUID } from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import ytdl from "yt-dlp-exec"

const dirname = path.dirname(fileURLToPath(import.meta.url))
const OPENROUTER_STT_MODEL = "qwen/qwen3-asr-1.7b"

export default defineConfig({
  plugins: [
    react(),
    {
      name: "scribeowl-api",
      configureServer(server) {
        server.middlewares.use("/api/video", async (req, res) => {
          try {
            const requestUrl = new URL(req.url || "", "http://localhost")
            const url = requestUrl.searchParams.get("url")
            if (!url) return sendJson(res, 400, { error: "Нет ссылки на видео." })
            const title = await getVideoTitle(url)
            sendJson(res, 200, { title })
          } catch (error) {
            sendJson(res, 200, { title: "" })
          }
        })

        server.middlewares.use("/api/transcribe", async (req, res) => {
          try {
            const payload = await readJson(req)
            if (!["deepgram", "openrouter", "openai"].includes(payload.providerId))
              return sendJson(res, 400, {
                error:
                  "AI-транскрипция сейчас подключена через Deepgram, OpenRouter и OpenAI."
              })
            if (!payload.apiKey)
              return sendJson(res, 400, { error: "Не добавлен API-ключ." })
            if (!payload.url) return sendJson(res, 400, { error: "Нет ссылки на видео." })

            const result = await transcribeYouTubeAudio(payload.url, payload)
            sendJson(
              res,
              200,
              typeof result === "string" ? { transcript: result } : result
            )
          } catch (error) {
            sendJson(res, error.status || 500, {
              error:
                error instanceof Error ? error.message : "AI-транскрипция не выполнена."
            })
          }
        })

        server.middlewares.use("/api/chat", async (req, res) => {
          try {
            const payload = await readJson(req)
            if (!payload.apiKey)
              return sendJson(res, 400, { error: "Не добавлен API-ключ." })
            if (!payload.question) return sendJson(res, 400, { error: "Введите вопрос." })
            if (!payload.transcript)
              return sendJson(res, 400, { error: "Сначала нужен AI-транскрипт." })

            const data =
              payload.providerId === "openai"
                ? await callOpenAI(payload)
                : payload.providerId === "openrouter"
                  ? await callOpenRouter(payload)
                  : { status: 400, body: { error: "Этот провайдер пока не подключен." } }

            sendJson(res, data.status, data.body)
          } catch (error) {
            sendJson(res, 500, {
              error: error instanceof Error ? error.message : "Чат не сработал."
            })
          }
        })
      }
    }
  ],
  resolve: {
    alias: {
      "@": dirname
    }
  }
})

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = ""
    req.on("data", (chunk) => (body += chunk))
    req.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}"))
      } catch (error) {
        reject(error)
      }
    })
    req.on("error", reject)
  })
}

async function getVideoTitle(url) {
  try {
    const response = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`
    )
    const data = await response.json()
    if (data.title) return data.title
  } catch {
    // fallback below
  }
  try {
    const info = await ytdl(url, {
      dumpSingleJson: true,
      skipDownload: true,
      noPlaylist: true
    })
    return info.title || ""
  } catch {
    return ""
  }
}

async function transcribeYouTubeAudio(url, payload) {
  const file = path.join(os.tmpdir(), `scribeowl-${randomUUID()}.m4a`)
  try {
    await ytdl.exec(url, {
      format: "140/139/bestaudio[ext=m4a]/bestaudio",
      output: file,
      noPlaylist: true,
      maxFilesize: "25m"
    })

    const audio = await fs.readFile(file)
    if (payload.providerId === "deepgram")
      return transcribeWithDeepgram(audio, payload.apiKey, payload.model)
    if (payload.providerId === "openrouter")
      return transcribeWithOpenRouter(audio, payload.apiKey)
    return transcribeWithOpenAI(audio, payload.apiKey)
  } catch (error) {
    if (error.status) throw error
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes("Requested format is not available"))
      throw new Error("Не удалось получить аудио из YouTube-видео.")
    if (message.includes("File is larger than max-filesize"))
      throw new Error("Видео слишком длинное для текущего лимита 25MB аудио.")
    throw new Error(message)
  } finally {
    await fs.rm(file, { force: true })
  }
}

async function transcribeWithDeepgram(audio, apiKey, model = "nova-3") {
  const params = new URLSearchParams({
    model,
    smart_format: "true",
    punctuate: "true",
    utterances: "true",
    diarize: "true",
    detect_language: "true"
  })
  const response = await fetch(`https://api.deepgram.com/v1/listen?${params}`, {
    method: "POST",
    headers: {
      Authorization: `Token ${apiKey}`,
      "content-type": "audio/mp4"
    },
    body: audio
  })
  const data = await response.json()
  if (!response.ok) {
    const error = new Error(
      data.err_msg || data.error || "Deepgram не вернул транскрипт."
    )
    error.status = response.status
    throw error
  }

  const alternative = data.results?.channels?.[0]?.alternatives?.[0]
  const utterances = Array.isArray(data.results?.utterances)
    ? data.results.utterances
    : []
  const segments = buildDeepgramSegments(alternative?.words || [], utterances)

  return {
    transcript: alternative?.transcript || segments.map((item) => item.text).join("\n"),
    segments
  }
}

function buildDeepgramSegments(words, utterances) {
  if (!Array.isArray(words) || !words.length) {
    return utterances
      .filter((item) => item.transcript)
      .map((item) => ({
        start: Number(item.start) || 0,
        end: Number(item.end) || 0,
        speaker: speakerName(item.speaker),
        text: item.transcript
      }))
  }

  const segments = []
  let current = null
  for (const word of words) {
    const text = word.punctuated_word || word.word
    if (!text) continue
    const speaker = speakerName(word.speaker)
    const start = Number(word.start) || 0
    const end = Number(word.end) || start

    if (!current || current.speaker !== speaker) {
      if (current) segments.push(current)
      current = { start, end, speaker, text }
      continue
    }

    current.end = end
    current.text += `${text.match(/^[,.;:!?)]/) ? "" : " "}${text}`

    if (/[.!?…]$/.test(text)) {
      segments.push(current)
      current = null
    }
  }
  if (current) segments.push(current)
  return mergeShortSegments(segments)
}

function speakerName(value) {
  return value != null && !Number.isNaN(Number(value))
    ? `Спикер ${Number(value) + 1}`
    : "Спикер 1"
}

function mergeShortSegments(segments) {
  const merged = []
  for (const segment of segments) {
    const previous = merged.at(-1)
    const previousDuration = previous ? previous.end - previous.start : 0
    const sameSpeaker = previous?.speaker === segment.speaker
    const shortEnough = previousDuration < 6 && segment.end - previous.start <= 9
    if (previous && sameSpeaker && shortEnough) {
      previous.end = segment.end
      previous.text += ` ${segment.text}`
    } else {
      merged.push({ ...segment })
    }
  }
  return merged
}

async function transcribeWithOpenAI(audio, apiKey) {
  const form = new FormData()
  form.append("file", new Blob([audio], { type: "audio/mp4" }), "audio.m4a")
  form.append("model", "whisper-1")
  form.append("response_format", "json")

  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form
  })
  const data = await response.json()
  if (!response.ok) {
    const error = new Error(data.error?.message || "OpenAI не вернул транскрипт.")
    error.status = response.status
    throw error
  }
  return data.text || ""
}

async function transcribeWithOpenRouter(audio, apiKey) {
  const response = await fetch("https://openrouter.ai/api/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": "http://127.0.0.1:5173",
      "X-Title": "Scribeowl"
    },
    body: JSON.stringify({
      model: OPENROUTER_STT_MODEL,
      input_audio: {
        data: audio.toString("base64"),
        format: "m4a"
      },
      language: "ru"
    })
  })
  const data = await response.json()
  if (!response.ok) {
    const error = new Error(data.error?.message || "OpenRouter не вернул транскрипт.")
    error.status = response.status
    throw error
  }
  return data.text || ""
}

async function callOpenRouter(payload) {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${payload.apiKey}`,
      "HTTP-Referer": "http://127.0.0.1:5173",
      "X-Title": "Scribeowl"
    },
    body: JSON.stringify(chatBody(payload))
  })
  const data = await response.json()
  return response.ok
    ? {
        status: 200,
        body: { answer: data.choices?.[0]?.message?.content || "Ответ пустой." }
      }
    : {
        status: response.status,
        body: { error: data.error?.message || "Запрос OpenRouter не выполнен." }
      }
}

async function callOpenAI(payload) {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${payload.apiKey}`
    },
    body: JSON.stringify(chatBody(payload))
  })
  const data = await response.json()
  return response.ok
    ? {
        status: 200,
        body: { answer: data.choices?.[0]?.message?.content || "Ответ пустой." }
      }
    : {
        status: response.status,
        body: { error: data.error?.message || "Запрос OpenAI не выполнен." }
      }
}

function chatBody(payload) {
  return {
    model: payload.model,
    messages: [
      {
        role: "system",
        content:
          "Отвечай на русском только по переданному транскрипту YouTube-видео. Не выдумывай факты вне транскрипта."
      },
      {
        role: "user",
        content: `Видео: ${payload.title}\nТранскрипт:\n${payload.transcript}\n\nВопрос: ${payload.question}`
      }
    ]
  }
}

function sendJson(res, status, data) {
  res.statusCode = status
  res.setHeader("content-type", "application/json; charset=utf-8")
  res.end(JSON.stringify(data))
}
