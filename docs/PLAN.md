# ScribeowlAI — план

Обновлено: 2026-09-25 (вечер). Предыдущая версия (с yt-dlp) — `docs/archive/PLAN-2026-09-25-ytdlp.md`.

## Цель продукта
Плеер для изучения языков: смотреть YouTube (фильмы, стендап и т.п.) и параллельно видеть текст оригинала с таймкодами + перевод. Перевод делаем сами через AI-провайдеров. Будут аккаунты и деплой.

## Ключевой поворот (2026-09-25)
- ❌ yt-dlp, PO Token (bgutil), скачивание аудио, серверная транскрипция аудио (STT), свой/кастомный плеер, проксирование видео — ОТКАЗАЛИСЬ, код удаляем.
  Причина: YouTube блокирует серверные запросы (антибот сработал даже на домашнем IP), а свой плеер поверх YouTube запрещён правилами.
- ✅ Видео — только официальный YouTube-плеер (iframe), его интерфейс не трогаем, ничего не кладём поверх.
- ✅ Позиция пользователя — из событий/времени iframe (YouTube IFrame API).
- ✅ Транскрипт — от внешних провайдеров транскриптов через фабрику на нашем сервере.

## Принятые решения
- Сервер: Python + FastAPI, Pydantic, деплой в Docker. Хостинг — позже.
- Фронт: React + Vite, отдельное SPA; общается только с нашим API.
- БД и аккаунты: Supabase (Postgres + Auth). Локально — Supabase CLI, порты 553xx.
- Ключи провайдеров (AI и транскриптов): только на сервере; в БД — AES-256-GCM, мастер-ключ в env. Фронт видит маску и статус.
- Чат: стриминг ответов (SSE).
- Перевод: AI по сегментам, кэш по (видео, язык).
- Деплой: GitHub Secrets + CD (GitHub Actions).

## Плеер
- YouTube iframe, стандартный интерфейс YouTube (controls по умолчанию).
- Правило YouTube: нельзя оверлеи поверх embedded-плеера → транскрипт, перевод, наши кнопки — в панели рядом/под плеером. https://developers.google.com/youtube/terms/required-minimum-functionality
- Часы плеера: getCurrentTime на requestAnimationFrame + интерполяция только в PLAYING и пока время растёт; заморозка при BUFFERING/PAUSED/ENDED/реклама; скачок времени = seek.
- Панель транскрипта: подсветка текущей фразы, автоскролл (пауза автоскролла, если пользователь листает), клик → seekTo, поиск.
- Дальше: перевод рядом с оригиналом, повтор фразы, клик по слову → объяснение (AI).
- Отладка: `?debug=1` — панель замеров (интервалы, drift, seek, заморозки).

## Плеер — замеры (2026-09-25, локально, Mac)
Среда: встроенный браузер Claude Desktop (Chromium) и Chrome через DevTools MCP; `?debug=1`. Сервер `POST /transcripts`, фронт http://127.0.0.1:5174.

**Транскрипт-провайдеры (живые запросы, без кэша):**

| Провайдер | Видео | Ответ | Сегментов | Время |
|---|---|---|---|---|
| youtube_transcript_ai | стендап SwpW4rEzNGM (14:30, авто-субтитры) | 200, 1.7 с | 401 (после фикса HTML-сущностей 404) | все approximate |
| youtube_transcript_ai | dQw4w9WgXcQ (3:27, ручные + 5 языков) | 200, 0.9 с | 34 | все approximate |
| youtube_transcript_ai | hBNgCuBTyaU (51:45) | 200 (через фронт) | 3290 | все approximate |
| transcriptapi | оба | не проверен: нет ключа (`configured=false`, 502 unauthorized) | — | — |

- Повторный запрос — из in-memory кэша: ~1 мс.
- youtube-transcript.ai на авто-субтитрах отдаёт **задвоенный текст** («oh helloo oh helloo hello…») — артефакт rolling-субтитров у провайдера. Для учебного плеера это заметно; transcriptapi (точные сегменты) нужно сравнить, когда будет ключ.
- `lang` у youtube-transcript.ai — точный код из списка (`de-DE`, не `de`); иначе молча отдаёт язык по умолчанию.
- HTML-сущности (`[&nbsp;__&nbsp;]`) — раскодируем в парсере.

**Часы плеера (YouTube IFrame API):**

| Сценарий | Интервал обновления reported (p50 / p90 / max) | drift \|interp−reported\| (p50 / p90 / max) |
|---|---|---|
| Стендап, 1× | 8.3 / 13.6 / 21 мс | 0.3 / 0.7 / 25.8 мс |
| Стендап, 1.5× (факт 1.497 видео-с/с) | 8.4 / 12.4 / 15 мс | 0.5 / 1.1 / 107 мс (в момент смены скорости) |
| Стендап, 0.5× (факт 0.506) | 8.3 / 9.3 / 19 мс | 0.2 / 0.4 / 163 мс (в момент смены скорости) |
| Яхта hBNgCuBTyaU, 1× | avg 93 мс (min 82, max 121) | avg 1 мс, max 61 мс |
| Стендап, Slow 3G, после буферизации | 8.4 / 12.3 / 19 мс | 0.3 / 0.7 / 1.5 мс |

- Частота `getCurrentTime` зависит от видео/сессии: от ~каждого кадра (8 мс) до ~100 мс. Интерполяция нужна именно для второго случая.
- Перемотка через таймлайн YouTube: подсветка на верной фразе через **13–19 мс** после seek (вперёд и назад).
- Смена скорости: YouTube отдаёт reported чуть «назад» (~0.1 с) → детектор ловит это как seek. Безвредно (сброс интерполяции), но это ложный seek в логе.
- Старт: CUED → BUFFERING ~1 с → PLAYING.
- Клик по фразе до первого запуска (CUED): `seekTo` без `playVideo` игнорируется → теперь seek + play.
- Slow 3G: транскрипт 3.9 с; iframe API готов через ~20–50 с после загрузки страницы. Клик по фразе до готовности плеера раньше терялся → теперь запоминается и применяется в onReady (проверено: клик на 12.8 с → играет с 02:06 на 32.9 с).
- Реклама: на проверенных видео в embed реклама **не показалась** — поведение getPlayerState/getCurrentTime во время рекламы не измерено. Защита на месте: «PLAYING, но время не растёт > 1 с» → заморозка (stalled), покрыто тестом.
- Не мерили: Safari (у пользователя), мобильные.

**UI:** активная фраза держится по центру панели транскрипта (плавный скролл только внутри панели, окно не двигается); автоскролл пауза 5 с после ручной прокрутки; кнопка «К текущей фразе».

## Транскрипты — провайдеры (фабрика на сервере)
- `TranscriptProvider` (абстрактный) → `YoutubeTranscriptAiProvider`, `TranscriptApiProvider`; `TranscriptProviderRegistry` (фабрика по id); порядок и fallback настраиваются.
- Единый результат: `Transcript { video_id, language, title?, duration?, available_languages[], provider_id, segments[{start, end, text, approximate}] }`.
- Единые ошибки: rate_limited, quota_exceeded, unauthorized, not_found, no_captions, network, parse.
- youtube-transcript.ai: без ключа, markdown, только абзацы `[m:ss]` → время внутри абзаца приблизительное; fair-use лимит (с IP дата-центра упёрлись с первого запроса). https://youtube-transcript.ai/youtube-transcript-api
- transcriptapi.com: `GET https://transcriptapi.com/api/v2/youtube/transcript`, `Authorization: Bearer <key>`, JSON с text/start/duration; 100 бесплатных кредитов, $5/мес = 1000 запросов, 200 RPM. Ключ только на сервере. https://transcriptapi.com/docs
- Кэш транскриптов — в таблице `transcripts` (следующий шаг: миграция под provider_id вместо youtube_manual/auto/stt).

## AI-провайдеры (без изменений)
- `BaseProvider` → `OpenAICompatibleProvider` (OpenAI, OpenRouter, Groq), `GeminiProvider`, `AnthropicProvider`; `ProviderRegistry`. Модели — по API провайдера.
- Задачи: translate / chat / summary (transcribe от AI-провайдеров больше не нужен).

## БД (Supabase)
- Миграция `supabase/migrations/20260925180000_init_schema.sql` применена локально: provider_credentials, ai_task_settings, videos, transcripts, translations, user_videos, chat_messages. RLS везде, клиентам доступ закрыт.
- TODO: новая миграция — transcripts.source → provider_id транскрипт-провайдера; provider_credentials.provider_id + 'transcriptapi'; ai_task_settings.task без 'transcribe'.

## Порядок работ
1. ✅ Локально: скелет сервера, локальный Supabase, схема БД.
2. ✅ Удалён yt-dlp-поток; фабрика транскрипт-провайдеров на сервере; часы плеера + панель транскрипта + debug-замеры (см. «Плеер — замеры»). Осталось: ключ transcriptapi + сравнение качества. Промпт: `docs/prompts/2026-09-25-transcripts-and-player.md`.
3. Миграция transcripts под провайдеров + кэш в БД.
4. ✅ AI-провайдеры (2026-09-25): вход Supabase Auth + проверка JWT на сервере; ключи в `provider_credentials` (AES-256-GCM, AAD user:provider); `BaseProvider` → `OpenAICompatibleProvider` (OpenAI, OpenRouter, Groq), `AnthropicProvider`, `GeminiProvider`; `ProviderRegistry`; модели из API провайдера (кэш 10 мин); выбор провайдера/модели по задачам (`ai_task_settings`); чат и саммари со стримингом SSE; профиль на фронте. Ключи из localStorage и Vite-мидлвар `/api/chat` удалены. Проверено реальными запросами с неверными ключами: OpenAI/Anthropic/Gemini → `unauthorized`, статус `invalid`, в БД только шифротекст. С настоящими ключами — не проверено (ключей нет).
   Gemini (сверено с ai.google.dev 2026-09-25): вся серия 2.5 ограничена для новых пользователей («limiting access to the 2.5 models to users who have actively used them in the past»), но отдаётся в /models → скрываем; рекомендуем gemini-3.8-flash и gemini-3.5-flash-lite; картинки/TTS/live/эмбеддинги/роботы скрыты; gemini-3.1-flash-lite помечена устаревающей. Правила — `server/app/ai/providers/gemini_catalog.py`. При сохранении модели — пробный запрос (≤16 токенов): недоступную модель не сохраняем.
   Ключи транскрипт-провайдеров (transcriptapi) — тоже в профиле пользователя (миграция `20260925200000_transcript_provider_credentials.sql` расширила provider_id), ключ сервера из env — запасной.
   ✅ Перевод транскрипта (2026-09-25): кнопка «Перевод» в панели транскрипта → язык (24 шт., поиск, ОК) → `POST /ai/translate` пачками ≤60 фраз/3000 символов, 2 параллельно, начиная с текущей фразы; формат с моделью «N|текст», повторный проход по пропущенным; оригинал слева, перевод справа; поиск и копирование учитывают перевод. Переводы пока хранятся в браузере (playlist) — кэш в таблице `translations` — следующий шаг.
   ✅ Ещё 3 транскрипт-провайдера (2026-09-25), порядок «Авто»: youtube-transcript.ai → TranscriptAPI → Supadata → ChocoData → EasyTranscriber. Форматы — по официальной документации (Supadata docs/llms.txt, ChocoData README/OpenAPI, EasyTranscriber OpenAPI); проверены реальными запросами с неверными ключами (все → unauthorized).
   - Supadata: x-api-key, mode=auto (распознаёт речь без субтитров, 2 кредита/мин), >20 мин — async jobId + опрос; «нет транскрипта» = HTTP 206; ключ проверяется бесплатным GET /me. Эхом возвращает ключ в ошибке → ключи вырезаются из всех сообщений провайдеров.
   - ChocoData: ключ только в query (api_key), без распознавания речи, units=seconds; бесплатной проверки ключа нет (запрос без video_id: 401/400).
   - EasyTranscriber: только сплошной текст, без времени фраз и выбора языка → строки раскладываются по длине видео (≈); бесплатно 5 кредитов; API, возможно, только на Pro.
   - Фолбэк: «нет субтитров» → дальше только провайдеры, распознающие речь (can_generate).
   Дальше: (задача translate уже выбирается в профиле), сохранение чата в `chat_messages` (нужна таблица videos с записями), свой base_url — только после защиты от SSRF.
5. GitHub Secrets + CD.
