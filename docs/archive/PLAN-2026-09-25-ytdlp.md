# ScribeowlAI — план

Обновлено: 2026-09-25. Статус: проектирование, код не менялся.

## Цель продукта
Плеер для изучения языков: смотреть YouTube (фильмы, стендап и т.п.) и параллельно видеть текст оригинала с таймкодами + перевод. Перевод делаем сами через AI-провайдеров. Будут аккаунты и деплой.

## Принятые решения (обновлено 2026-09-25, вечер)
- Плеер: обычный YouTube iframe, его интерфейс не трогаем; транскрипт — в панели рядом. Позиция — из событий/времени iframe.
- Источник транскрипта №1: youtube-transcript.ai (из браузера, без ключа, CORS открыт; только абзацы с таймкодами [m:ss]; fair-use лимит; коммерческое использование — по договорённости). №2: сервер yt-dlp. Локальный IP уже получил антибот-блок yt-dlp (2026-09-25).
- Промпт реализации: docs/prompts/2026-09-25-player-sync.md

## Принятые решения (ранее)
- Сервер: Python + FastAPI, Pydantic-модели, деплой в Docker.
- Фронт: отдельное SPA на CDN, общается с сервером только по API (CORS или один домен + reverse proxy). SSR не нужен. PWA — опционально позже.
- БД и аккаунты: Supabase (Postgres + Auth). Сервер проверяет JWT Supabase.
- Ключи AI-провайдеров: только на сервере, в БД, зашифрованы AES-256-GCM на уровне приложения (мастер-ключ `CREDENTIALS_ENCRYPTION_KEY` в env сервера). Утечка только БД или только env ключи не раскрывает. Фронт видит только маску и статус.
- Фронт: остаётся React + Vite.
- Чат: стриминг ответов нужен (SSE).
- Supabase: проекта пока нет. Локально — Supabase CLI (локальный стек в Docker); облачный проект — при деплое.
- Деплой: секреты в GitHub Secrets, CD (GitHub Actions) деплоит на сервер. Хостинг — выбрать позже.
- Видео: не храним и не проксируем. Воспроизведение — в браузере пользователя (YouTube iframe со скрытыми контролами + наш UI поверх).
- Куки YouTube пользователя на сервер не передаём.
- Текст: 1) субтитры YouTube (ручные > авто) через yt-dlp; 2) если нет — аудио через yt-dlp → распознавание речи.
- yt-dlp ставим на сервер + плагин PO Token (bgutil-ytdlp-pot-provider).
- Перевод: AI по сегментам с таймкодами, кэш по (видео, язык).

## Этапы

### Этап 0. Проверка yt-dlp (риск №1) — ✅ локально пройден 2026-09-25
Mac, yt-dlp 2026.8.19 + bgutil-pot (Docker) + deno. Стендап 892s: metadata 3.3s; авто-субтитры en-orig 0.6s — 334 сегмента, 2250 слов с таймкодами; аудио-фолбэк 6.4s, 14.4 MB m4a. Осталось: повторить с облачного IP при деплое.
- Установить yt-dlp + ffmpeg + bgutil-ytdlp-pot-provider.
- Скрипт: ссылка → список субтитров → скачать субтитры (json3/vtt); если нет — только аудио (m4a).
- Прогнать локально и с облачного IP (контейнер на VPS). Зафиксировать результат.

### Этап 1. Скелет сервера
- Папка `server/`: FastAPI, конфиг из env, Dockerfile (python + ffmpeg + yt-dlp + PO-token плагин).
- Healthcheck, CORS, проверка JWT Supabase.
- Фоновые задачи/очередь для транскрипции (arq или аналог).

### Этап 2. Модель данных (Pydantic; TS-типы для фронта генерируем из OpenAPI)
- `ProviderId` — openai | openrouter | google | anthropic | groq | deepgram
- `Capability` — transcribe | translate | chat | summary
- `ProviderDescriptor` — id, name, capabilities[], auth_type, docs_url
- `ProviderCredentials` — provider_id, api_key, base_url?, extra?, updated_at
- `ModelInfo` — id, provider_id, display_name, capabilities[], context_window?, deprecated?
- `ChatRequest` / `ChatResponse`
- `TranscriptSegment` — start, end, speaker?, text, words[]? (таймкоды слов)
- `Transcript` — video_id, language, source (youtube_manual | youtube_auto | stt), segments[]
- `Translation` — video_id, target_language, segments[] (привязка к исходным сегментам)
- `ProviderError` — status, code, message
- `AiSettings` — по задачам: transcribe / translate / chat / summary → {provider_id, model_id}

### Этап 3. Провайдеры (классы)
- `BaseProvider` (абстрактный): list_models(), test_connection(), chat(), transcribe(); общий request() + нормализация ошибок.
- `OpenAICompatibleProvider(BaseProvider)` → `OpenAIProvider`, `OpenRouterProvider` (доп. заголовки), `GroqProvider`.
- `GeminiProvider`, `AnthropicProvider` — свои форматы API.
- `DeepgramProvider` — только transcribe.
- `ProviderRegistry` — provider_id → класс с креденшалами.

### Этап 4. Сервисы
- `CredentialStore` — ключи в Supabase, шифрование.
- `ModelCatalogService` — модели по API провайдера, кэш (TTL), фильтр по capability.
- `AiSettingsService` — выбор провайдера/модели по задачам.
- `YouTubeService` — метаданные, субтитры, аудио (yt-dlp).
- `TranscriptService` — субтитры YouTube или STT → `Transcript` в БД.
- `TranslationService` — перевод сегментов, кэш.

### Этап 5. API
- `GET /providers`, `PUT|DELETE /providers/{id}/credentials`, `POST /providers/{id}/test`, `GET /providers/{id}/models`
- `GET|PUT /settings/ai`
- `POST /videos` (ссылка → метаданные), `POST /videos/{id}/transcript` (задача), `GET /videos/{id}/transcript`
- `POST /videos/{id}/translations`, `GET /videos/{id}/translations/{lang}`
- `POST /videos/{id}/chat`, `POST /videos/{id}/summary`

### Этап 6. БД (Supabase) — миграция `supabase/migrations/20260925180000_init_schema.sql`
Таблицы: provider_credentials, ai_task_settings, videos, transcripts, translations, user_videos, chat_messages.
Видео/транскрипты/переводы — общий кэш для всех пользователей. Доступ клиентов закрыт (RLS без политик + revoke), работает только сервер.
✅ Применена локально 2026-09-25: 7 таблиц, RLS везде, грантов anon/authenticated нет, триггер updated_at работает; REST с publishable key → 401/42501, с secret key → 200.
- `provider_credentials`: id, user_id → auth.users, provider_id, encrypted_key, iv, auth_tag, key_hint, base_url?, extra?, status, last_checked_at, created_at, updated_at. Уникально (user_id, provider_id). RLS: без доступа для anon/authenticated, работает только сервер (service_role).
- `ai_settings`, `videos`, `transcripts`, `translations`, `user_videos` (плейлист), `chat_messages`.
- `SUPABASE_SERVICE_ROLE_KEY`, мастер-ключ шифрования — только в env сервера.

### Плеер (спецификация, 2026-09-25)
- Видео: YouTube iframe, `controls=0`, управление через IFrame API (getCurrentTime, seekTo, setPlaybackRate, pause/play).
- ⚠️ Правила YouTube (Required Minimum Functionality): НЕЛЬЗЯ класть оверлеи/элементы поверх embedded-плеера и закрывать его части. Поэтому субтитры и наши кнопки — ПОД/РЯДОМ с плеером, не поверх. Полноэкранный режим — на наш контейнер: видео сверху, панель субтитров снизу, без перекрытия.
- Что YouTube всё равно показывает при controls=0: название и аватар канала (до старта, на паузе, в конце), похожие видео в конце (rel=0 — только с того же канала), реклама со своим интерфейсом, логотип. modestbranding/showinfo не работают. Источники: https://developers.google.com/youtube/player_parameters , https://developers.google.com/youtube/terms/required-minimum-functionality
- Синхронизация: опрос getCurrentTime ~каждые 100–200 мс (requestAnimationFrame), бинарный поиск текущего сегмента/слова.
- Двойные субтитры: оригинал + перевод, включаются по отдельности.
- Караоке-подсветка слова (таймкоды слов из json3 авто-субтитров).
- Клик по слову → перевод/объяснение слова (AI), пауза.
- Клик по фразе в списке → перемотка; кнопки: предыдущая/следующая фраза, повтор фразы (A-B loop), авто-пауза после фразы.
- Скорость 0.5–1.5; горячие клавиши.
- Панель транскрипта: список фраз с автоскроллом к текущей, поиск.
- Перевод догружается порциями, начиная с текущего места видео.

### Этап 7. Фронт
- Профиль: ключ на каждого провайдера, статус, «Проверить»; выбор провайдера+модели по задачам (модели — по API).
- Плеер: iframe без контролов + свой UI; двойные субтитры (оригинал + перевод), клик по фразе, повтор фразы, скорость.
- Убрать старый Plasmo-код (`src/background`, `contexts`, `utils/llm.ts`) и middleware из `vite.config.mjs`.

## Открытые вопросы
- Хостинг сервера (VPS / Fly.io / Railway и т.п.) — пользователь скажет позже.

## Порядок работ
1. Локальная настройка — ✅ базово готова 2026-09-25 (сервер-скелет, yt-dlp, локальный Supabase 553xx, миграция) — см. `docs/LOCAL_SETUP.md`. Готово: скелет `server/` (FastAPI, /health, /youtube/info, /youtube/subtitles, скрипт этапа 0, тесты), `docker-compose.yml` (bgutil-pot). Проверено в изолированной среде: зависимости ставятся, тесты проходят, /health отвечает; YouTube оттуда недоступен — живой тест на Mac.
2. GitHub Secrets + CD на сервер (следующий шаг).

## Факты (проверено 2026-09-25)
- YouTube IFrame API не отдаёт текст субтитров — только управление плеером.
- yt-dlp: для субтитров (клиент web) и аудио (GVS) нужен PO Token; плагины bgutil-ytdlp-pot-provider, yt-dlp-getpot-wpc. https://github.com/yt-dlp/yt-dlp/wiki/PO-Token-Guide
- Supabase Vault: https://supabase.com/docs/guides/database/vault
- Gemini 1.5 нет в актуальном списке моделей: https://ai.google.dev/gemini-api/docs/models

## Эндпоинты списка моделей (проверить при реализации)
- OpenAI: GET https://api.openai.com/v1/models
- OpenRouter: GET https://openrouter.ai/api/v1/models
- Google: GET https://generativelanguage.googleapis.com/v1beta/models
- Anthropic: GET https://api.anthropic.com/v1/models
- Groq: GET https://api.groq.com/openai/v1/models
- Deepgram: GET https://api.deepgram.com/v1/models
