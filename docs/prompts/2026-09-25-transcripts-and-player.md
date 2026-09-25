# Задача: убрать yt-dlp, фабрика транскрипт-провайдеров, синхронизация с YouTube iframe

Проект: /Users/khramovw/Development/Projects/ScribeowlAI. Прочитай `docs/PLAN.md` (раздел «Ключевой поворот»). Фронт — React + Vite (`src/App.tsx`), сервер — FastAPI (`server/`, uv).

## Решения (не менять)
- Видео — только официальный YouTube iframe, его интерфейс не трогаем, ничего не кладём поверх iframe.
- Позиция пользователя — только из YouTube IFrame API.
- yt-dlp, PO Token, скачивание аудио, серверный STT, кастомный плеер — удаляем полностью.
- Транскрипты — внешние провайдеры через фабрику на нашем сервере. Ключи провайдеров — только на сервере, во фронт не попадают.

## Часть 1. Удалить yt-dlp-поток
1. Сервер: удалить `server/app/services/youtube.py`, `server/app/api/youtube.py`, `server/scripts/probe_youtube.py`, `server/tests/test_json3.py`; из `server/pyproject.toml` убрать `yt-dlp[default]` и `bgutil-ytdlp-pot-provider`, затем `uv sync`; из `config.py` и `.env.example`/`.env` убрать `BGUTIL_BASE_URL`, `TMP_DIR`, `AUDIO_MAX_FILESIZE`.
2. Docker: `docker compose down` для сервиса bgutil-pot, удалить `docker-compose.yml` (в нём только этот сервис). Контейнер `scribeowl-bgutil-pot` остановить и удалить.
3. Фронт/Vite: удалить из `vite.config.mjs` middleware `/api/transcribe` и `/api/video`, функции yt-dlp / Deepgram / OpenAI Whisper / OpenRouter STT; убрать зависимость `yt-dlp-exec` из `package.json` (pnpm). Во фронте убрать кнопки/статусы «AI-транскрипция», вызовы `/youtube/subtitles`, `/api/transcribe`. Middleware `/api/chat` пока не трогать.
4. `docs/LOCAL_SETUP.md`: убрать разделы про deno/ffmpeg/bgutil/yt-dlp и этап 0; оставить uv, Supabase, запуск сервера и фронта.
5. `grep -ri "yt-dlp\|ytdl\|bgutil\|yt_dlp" --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=docs/archive .` должен ничего не находить (кроме `docs/archive`).

## Часть 2. Сервер: фабрика транскрипт-провайдеров
Структура `server/app/transcripts/`:
- `models.py` (Pydantic):
  - `TranscriptSegment { start: float, end: float, text: str, approximate: bool }`
  - `Transcript { video_id, language, title: str|None, duration: float|None, available_languages: list[str], provider_id, segments: list[TranscriptSegment] }`
  - `TranscriptProviderInfo { id, name, requires_api_key, configured: bool, docs_url }`
- `errors.py`: `TranscriptError(code, message, provider_id, status)`; коды: `rate_limited, quota_exceeded, unauthorized, not_found, no_captions, network, parse`.
- `base.py`: абстрактный `TranscriptProvider` — `id`, `name`, `requires_api_key`, `docs_url`, `async fetch(video_id: str, language: str|None) -> Transcript`; общий httpx-клиент с таймаутом; маппинг HTTP-статусов в коды ошибок.
- `normalize.py`: общие функции — конец сегмента = начало следующего (последний = duration); деление абзаца на предложения и распределение времени пропорционально длине (approximate=True).
- `providers/youtube_transcript_ai.py`: `GET https://youtube-transcript.ai/transcript/{id}.txt?lang=` (без ключа, ответ markdown: заголовок с Language/Duration/доступными языками, абзацы `[m:ss]` / `[h:mm:ss]`). Ответ с текстом «calling this API at high volume» → `rate_limited`. Сегменты — approximate.
- `providers/transcriptapi.py`: `GET https://transcriptapi.com/api/v2/youtube/transcript`, `Authorization: Bearer <TRANSCRIPTAPI_API_KEY>`, `video_url`, `format=json`, `language`. Параметры и формат ответа сначала сверить с https://transcriptapi.com/docs (API Reference) — не угадывать. Сегменты `start`, `start+duration` → approximate=False.
- `registry.py`: `TranscriptProviderRegistry` — регистрация классов, `get(id)`, `list()`, `ordered()` по `TRANSCRIPT_PROVIDERS_ORDER` из env (по умолчанию `youtube_transcript_ai,transcriptapi`); провайдер с обязательным ключом без ключа — `configured=False`, пропускается.
- `service.py`: `TranscriptService.get(video_id, language, provider_id|None)` — либо конкретный провайдер, либо по порядку с фолбэком при `rate_limited/quota_exceeded/network/unauthorized`; in-memory кэш (TTL 24ч) по (video_id, language, provider_id). БД пока не трогаем.
- Извлечение `video_id` из любых форм ссылки YouTube (watch?v=, youtu.be/, shorts/, embed/) — `utils/youtube_id.py`, без сетевых запросов.

API (`server/app/api/transcripts.py`):
- `GET /transcripts/providers` → список `TranscriptProviderInfo`.
- `POST /transcripts` `{ url | video_id, language?, provider_id? }` → `Transcript`; ошибки → HTTP 4xx/5xx с `{ code, message, provider_id }`, 429 для rate_limited.

Конфиг: `TRANSCRIPTAPI_API_KEY`, `TRANSCRIPT_PROVIDERS_ORDER` в `config.py` и `.env.example` (без значений). Ключ transcriptapi — в `server/.env`; где взять и куда записан — в `docs/secrets/transcript-providers.md` (папка в .gitignore). Если ключа ещё нет — провайдер просто `configured=False`.

Тесты (pytest, без сети — httpx MockTransport / respx): парсер youtube-transcript.ai по реальной фикстуре (сохранить реальный ответ в `server/tests/fixtures/`; если лимит — сообщить, формат не выдумывать), маппинг transcriptapi по фикстуре из документации/реального ответа, нормализация, фолбэк в сервисе, извлечение video_id.

## Часть 3. Фронт: часы плеера и панель транскрипта
- `VITE_API_URL` (по умолчанию `http://127.0.0.1:8000`); загрузка транскрипта — `POST /transcripts`, показать, какой провайдер отдал; выбор провайдера в панели (dropdown из `GET /transcripts/providers`, «Авто» по умолчанию). Результат сохраняется в существующее поле транскрипта видео в плейлисте.
- `src/player/clock.ts` (чистые функции) + `src/player/usePlayerClock.ts` (YouTube IFrame API):
  - подписка `onReady`, `onStateChange`, `onPlaybackRateChange`; на `requestAnimationFrame` читаем `getCurrentTime()` = reported time;
  - интерполяция только в PLAYING и если reported time менялось последнюю секунду: `lastReported + (now - lastReportedAt) * rate`, не дальше 1 с от lastReported;
  - BUFFERING/PAUSED/ENDED/CUED и «PLAYING, но время не растёт > 1 с» (реклама/подвисание) → заморозка на reported;
  - скачок > 1.5 с вперёд или любой назад → seek, сброс интерполяции;
  - наружу `{ time, state, playbackRate, lastSeekAt }`.
- Панель «Транскрипт»: активный сегмент — бинарный поиск по `start`, подсветка; автоскролл, но не если пользователь листал последние 5 с; кнопка «к текущему» (иконка прицела); клик → `seekTo(start, true)`; пометка «≈» для approximate; поиск и копирование сохранить.
- Отладка `?debug=1` — панель ПОД плеером: reported/interpolated time, state, rate; интервалы обновлений reported time (min/avg/max за 30 с); drift (interpolated − reported в момент нового reported) avg/max; лог seek и заморозок.
- Тесты фронта: vitest для `clock.ts` (интерполяция, заморозка, seek, скорость 0.5/1.5).

## Проверка и отчёт
1. `uv run pytest -q`, `pnpm vitest run`, `pnpm build` — зелёные.
2. Живой запрос `POST /transcripts` к каждому провайдеру на 2 видео (стендап + любое): время ответа, число сегментов, approximate или нет.
3. С `?debug=1` на стендапе: интервал обновлений reported time, drift; перемотка через таймлайн YouTube — через сколько мс подсветка встала на верный сегмент; скорость 0.5 и 1.5; DevTools → Slow 3G; видео с рекламой — что отдают getPlayerState/getCurrentTime во время рекламы.
4. Цифры записать в `docs/PLAN.md` раздел «Плеер — замеры».
5. Обновить `docs/LOCAL_SETUP.md`.

## Не делать
- Не менять схему БД (миграция — следующий шаг).
- Не класть элементы поверх iframe, не прятать интерфейс YouTube.
- Не выдумывать форматы ответов API — только по документации и реальным ответам.
- Не коммитить (коммит — отдельно, по команде).

В конце пришли: удалённые/изменённые файлы, результат grep из части 1, результаты тестов, цифры из п.2–3.
