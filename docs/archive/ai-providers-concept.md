# Концепция: AI-провайдеры (черновик)

Дата: 2026-09-25. Статус: обсуждение, код не менялся.

## Цель продукта (2026-09-25)
Плеер для изучения языков: смотреть YouTube (фильмы, стендап и т.п.) и параллельно видеть текст оригинала с таймкодами + перевод. Перевод делаем сами через AI-провайдеров.

## Решения по видео и тексту (2026-09-25)
- Видео нигде не храним и не проксируем через сервер. Воспроизведение — в браузере пользователя.
- Куки пользователя YouTube на сервер НЕ передаём (риск блокировки аккаунта пользователя и хранения его Google-сессии).
- Источник текста, по приоритету: 1) субтитры YouTube (ручные > автоматические); 2) если их нет — аудио через yt-dlp → распознавание речи (Deepgram и др.).
- Перевод: AI по сегментам с таймкодами; кэшировать по (видео, язык), чтобы не платить повторно.

## Факты (проверено 2026-09-25)
- YouTube IFrame API не отдаёт текст субтитров — только управление плеером.
- yt-dlp: для субтитров (клиент web) и аудиопотоков (GVS) нужен PO Token; рекомендованы плагины bgutil-ytdlp-pot-provider, yt-dlp-getpot-wpc. Источник: https://github.com/yt-dlp/yt-dlp/wiki/PO-Token-Guide

## Проблема сейчас
- Провайдеры описаны массивом в `src/App.tsx`, логика запросов — функциями в `vite.config.mjs`.
- Один провайдер + один ключ на всё (`scribeowl.providerId`, `scribeowl.apiKey`) — нельзя Deepgram для транскрипта и Gemini для чата.
- Google/Anthropic/Groq — только карточки, на бэке не реализованы.
- Списки моделей захардкожены и устарели (gemini-1.5-*).

## Цели
1. Один общий контракт (модель данных) для всех провайдеров.
2. Отдельный класс на каждого провайдера, наследуется от базового; отличия — расширением класса.
3. Отдельное хранилище креденшалов (ключ на каждого провайдера).
4. Модели подтягиваются по API провайдера, а не хардкодом.
5. Выбор провайдера+модели отдельно для каждой задачи (транскрипция / саммари / чат).

## 1. Модель данных (TypeScript, общая для фронта и бэка)
- `ProviderId` — 'openai' | 'openrouter' | 'google' | 'anthropic' | 'groq' | 'deepgram'
- `Capability` — 'transcribe' | 'chat' | 'summary'
- `ProviderDescriptor` — id, name, capabilities[], authType, docsUrl
- `ProviderCredentials` — providerId, apiKey, baseUrl?, extra? (напр. org id), updatedAt
- `ModelInfo` — id, providerId, displayName, capabilities[], contextWindow?, deprecated?
- `ChatRequest` / `ChatResponse` — нормализованные messages[], model, ответ, usage?
- `TranscribeRequest` / `TranscriptResult` — text + segments[] {start, end, speaker, text}
- `ProviderError` — status, code, message (единый формат ошибок)
- `AiSettings` — назначение по задачам: { transcribe: {providerId, modelId}, chat: {...}, summary: {...} }

## 2. Классы провайдеров
- `abstract BaseProvider` — descriptor, credentials; `listModels()`, `testConnection()`, `chat()`, `transcribe()`; общий `request()` + нормализация ошибок.
- `OpenAICompatibleProvider extends BaseProvider` — общий формат chat/completions:
  - `OpenAIProvider`
  - `OpenRouterProvider` (доп. заголовки HTTP-Referer / X-Title)
  - `GroqProvider`
- `GeminiProvider` — свой формат (generateContent).
- `AnthropicProvider` — свой формат (messages API).
- `DeepgramProvider` — только transcribe.
- `ProviderRegistry` — фабрика: providerId -> экземпляр класса с креденшалами.

## 3. Сервисы
- `CredentialStore` — интерфейс get/set/delete/list; реализация — см. открытый вопрос ниже.
- `ModelCatalogService` — вызывает `listModels()`, кэширует (TTL), фильтрует по capability.
- `AiSettingsService` — хранит выбор провайдера/модели по задачам.

## 4. API (бэкенд)
- `GET /api/providers` — список + статус (ключ есть / проверен)
- `PUT|DELETE /api/providers/:id/credentials`
- `POST /api/providers/:id/test` — проверить ключ
- `GET /api/providers/:id/models` — актуальные модели
- `POST /api/chat`, `POST /api/transcribe` — берут провайдера из `AiSettings`

## 5. Фронтенд (страница профиля)
- Список провайдеров: ключ на каждого, статус, кнопка «Проверить».
- Блоки «Транскрипция», «Саммари», «Чат» — выбор провайдера + модели из списка по API.
- Скрывать/блокировать провайдеров без нужной capability.

## 6. Инфраструктура
- Вынести бэкенд из `vite.config.mjs` в папку `server/` (vite только подключает middleware).
- Удалить/отделить старый код Plasmo-расширения (`src/background`, `contexts`, `utils/llm.ts`), если не нужен.

## Решение: хранение ключей (2026-09-25)
- В браузере ключи НЕ храним. Фронт никогда не получает ключ целиком — только маску (`sk-...a1b2`) и статус.
- Ключи пользователей — в БД, зашифрованные (AES-256-GCM, уникальный IV на запись).
- Мастер-ключ шифрования — в переменной окружения (`CREDENTIALS_ENCRYPTION_KEY`), не в коде и не в БД.
- Таблица `provider_credentials`: id, user_id, provider_id, encrypted_key, iv, auth_tag, key_hint (последние 4 символа), base_url?, extra (json)?, status, last_checked_at, created_at, updated_at. Уникальность: (user_id, provider_id).
- Расшифровка — только внутри бэкенда в момент запроса к провайдеру; ключи не логируем.
- Env-файлы — только для системных секретов (мастер-ключ, доступ к БД), не для пользовательских ключей.

## Решение: БД и аккаунты (2026-09-25)
- Будут аккаунты и деплой → Supabase (Postgres + Supabase Auth). `@supabase/supabase-js` уже в зависимостях.
- `provider_credentials.user_id` → `auth.users.id`.
- RLS включён; для ролей `anon`/`authenticated` — никакого доступа к таблице ключей. Читает/пишет только наш бэкенд (service_role), после проверки JWT пользователя.
- `SUPABASE_SERVICE_ROLE_KEY` — только в env сервера, никогда во фронте.
- Шифрование (предложение): на уровне приложения (AES-256-GCM, мастер-ключ в env сервера). Утечка только БД или только env не раскрывает ключи. Альтернатива — Supabase Vault (`vault.create_secret`, view `vault.decrypted_secrets`), но это привязка к Supabase + RPC-функции. Выбор — подтвердить.

## Открытые вопросы
- Шифрование: AES на уровне приложения или Supabase Vault?
- Есть ли уже проект в Supabase (URL, ключи)? Секреты — в project-документации (не в git).
- Нужен ли стриминг ответов в чате?

## Эндпоинты списка моделей (проверить по докам при реализации)
- OpenAI: GET https://api.openai.com/v1/models
- OpenRouter: GET https://openrouter.ai/api/v1/models
- Google: GET https://generativelanguage.googleapis.com/v1beta/models
- Anthropic: GET https://api.anthropic.com/v1/models
- Groq: GET https://api.groq.com/openai/v1/models
- Deepgram: GET https://api.deepgram.com/v1/models
