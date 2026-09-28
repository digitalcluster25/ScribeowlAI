# Локальная настройка (macOS)

## 0. Секреты и git
- Секреты только в `server/.env`, `.env.local`, `docs/secrets/` — всё в `.gitignore` (как и любые `.env*`, кроме `*.env.example`).
- Защита от случайного коммита ключей (один раз на машине):
```bash
brew install gitleaks
git config core.hooksPath .githooks   # pre-commit: gitleaks по staged + запрет env-файлов
gitleaks git --log-opts="--all" --config .gitleaks.toml .   # ручная проверка всей истории
```
- Во фронт (`VITE_*`) — только публичные значения (publishable key). Secret/service_role key и мастер-ключ — только на сервере.

## 1. Инструменты
```bash
brew install uv
brew install supabase/tap/supabase
corepack enable   # pnpm для фронта (или: COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm ...)
```
Docker Desktop — нужен для локального Supabase (https://www.docker.com/products/docker-desktop/).

- `uv` — Python-окружение сервера.
- `supabase` — локальный Supabase (Postgres + Auth) в Docker.
- `pnpm` — зависимости и сборка фронта.

## 2. Сервер (FastAPI)
Код сервера — отдельный репозиторий [ScribeowlAI_server](https://github.com/digitalcluster25/ScribeowlAI_server) (папка `server/` рядом с `client/`).
```bash
cd server
cp .env.example .env      # заполнить Supabase и (опционально) TRANSCRIPTAPI_API_KEY
uv sync
uv run pytest -q
uv run uvicorn app.main:app --reload --port 8000
```
Проверка: http://127.0.0.1:8000/health, документация API: http://127.0.0.1:8000/docs

Транскрипты:
- `GET /transcripts/providers` — список провайдеров и `configured`.
- `POST /transcripts` `{ "url": "https://youtu.be/<id>" }` (или `video_id`, `language`, `provider_id`) → сегменты `{start, end, text, approximate}`.
- Порядок фолбэка — `TRANSCRIPT_PROVIDERS_ORDER` (по умолчанию `youtube_transcript_ai,transcriptapi,supadata,chocodata,easytranscriber`). Запасные ключи сервера: `TRANSCRIPTAPI_API_KEY`, `SUPADATA_API_KEY`, `CHOCODATA_API_KEY`, `EASYTRANSCRIBER_API_KEY`; ключ пользователя из профиля важнее.
- Ключ transcriptapi.com: пользователь добавляет свой в «Профиль → Транскрипты» (шифруется, как ключи AI; проверка — бесплатный `GET /api/v2/youtube/info`). `TRANSCRIPTAPI_API_KEY` в `server/.env` — запасной ключ сервера; ключ пользователя важнее. Без обоих провайдер пропускается.
- Ключи транскрипции: `PUT|DELETE /transcripts/providers/{id}/credentials`, `POST /transcripts/providers/{id}/test` (нужен вход). `GET /transcripts/providers` и `POST /transcripts` работают и без входа (тогда только ключи сервера).

```bash
curl -s -X POST http://127.0.0.1:8000/transcripts -H 'content-type: application/json' \
  -d '{"url":"https://www.youtube.com/watch?v=dQw4w9WgXcQ"}' | head -c 400
```

## 2a. AI-провайдеры (ключи пользователей)
- Вход — Supabase Auth (email + пароль). Сервер проверяет JWT по JWKS локального Supabase (`/auth/v1/.well-known/jwks.json`, ES256).
- Ключи провайдеров (OpenRouter, OpenAI, Anthropic, Google Gemini, Groq) вводятся в «Профиле», хранятся в `provider_credentials` зашифрованными AES-256-GCM (AAD = user_id:provider_id). Мастер-ключ — `CREDENTIALS_ENCRYPTION_KEY` в `server/.env` (base64 от 32 байт), версия — `CREDENTIALS_KEY_VERSION`.
- Наружу отдаётся только маска (`key_hint`, последние 4 символа) и статус проверки.
- Эндпоинты (нужен `Authorization: Bearer <supabase access token>`):
  - `GET /providers`, `PUT|DELETE /providers/{id}/credentials`, `POST /providers/{id}/test`, `GET /providers/{id}/models[?refresh=true]`
  - `GET /settings/ai`, `PUT|DELETE /settings/ai/{translate|chat|summary}`
  - `POST /ai/stream` `{task: chat|summary, title, transcript, messages}` → SSE: `start`, `delta {text}`, `done` | `error {code,message,provider_id}`
- Локальный dev-пользователь и мастер-ключ — в `docs/secrets/supabase-local.md`.

## 3. Фронт (React + Vite)
```bash
pnpm install
pnpm exec vite --host 127.0.0.1 --port 5174 --strictPort   # 5173 может быть занят другим проектом
pnpm vitest run     # тесты часов плеера
pnpm build
```
Переменные фронта — `.env.local` (шаблон `.env.example`): `VITE_API_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` (публичные значения). После изменения — перезапустить Vite.

Открыть http://127.0.0.1:5174. Фронт ходит в API по `VITE_API_URL` (по умолчанию `http://127.0.0.1:8000`, CORS для 5173/5174 разрешён в `CORS_ORIGINS`).

- Видео — официальный YouTube iframe, поверх ничего не кладём.
- Вставить ссылку → `POST /transcripts` → вкладка «Транскрипт»: подсветка текущей фразы, клик → перемотка, «≈» — время фразы приблизительное.
- `?debug=1` (http://127.0.0.1:5174/?debug=1) — панель замеров под плеером: reported/interpolated time, интервалы, drift, seek и заморозки.

Для превью в Claude Desktop команды лежат в `.claude/launch.json` (`api`, `web`).

## 4. База данных (Supabase)
Схема БД и миграции живут в серверном репозитории
[ScribeowlAI_server](https://github.com/digitalcluster25/ScribeowlAI_server) → `supabase/`
(перенесены туда из этого репозитория 2026-09-25). Запуск, миграции и проверка схемы — в README сервера.

```bash
cd ../server            # папка серверного репозитория рядом с client/
supabase start          # локальный стек в Docker, порты 553xx
```

Что нужно фронту из запущенного стека (значения — `supabase status -o env`, в `.env.local`):
- `VITE_SUPABASE_URL` = API: http://127.0.0.1:55321
- `VITE_SUPABASE_PUBLISHABLE_KEY` = `PUBLISHABLE_KEY` (публичный)
- Studio: http://127.0.0.1:55323 · письма Auth (Mailpit): http://127.0.0.1:55324

Ключи и полный вывод `supabase status` — в `docs/secrets/supabase-local.md` (папка в `.gitignore`).
