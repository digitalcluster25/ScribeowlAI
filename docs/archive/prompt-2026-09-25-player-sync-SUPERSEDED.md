# Задача: транскрипт из youtube-transcript.ai + синхронизация с YouTube iframe

Проект: /Users/khramovw/Development/Projects/ScribeowlAI (фронт React + Vite, `src/App.tsx`; сервер FastAPI в `server/`). План — `docs/PLAN.md`. Сначала изучи текущее состояние `src/App.tsx` и что уже сделано по субтитрам (сейчас в UI ошибка «YouTube временно ограничил запросы с этого IP (антибот-проверка)» от серверного yt-dlp).

## Решения (не менять)
- Видео — обычный YouTube iframe, его интерфейс НЕ трогаем (controls по умолчанию). Ничего не кладём поверх iframe (правила YouTube). Транскрипт — в правой панели «Транскрипт».
- Источник транскрипта №1 — youtube-transcript.ai, вызов прямо из браузера. №2 (фолбэк) — наш сервер `POST /youtube/subtitles` (yt-dlp).
- Позиция пользователя — только из событий/времени iframe (YouTube IFrame API), не угадываем.

## Факты об API youtube-transcript.ai (проверено по https://youtube-transcript.ai/youtube-transcript-api)
- `GET https://youtube-transcript.ai/transcript/{VIDEO_ID}.txt?lang={code}` — без ключа, CORS открыт, fair-use лимиты, кэш 24ч.
- Ответ — `text/markdown`: заголовок (`# Transcript: ...`, `Language: en · Duration: 3:27 · Words: 481`, список доступных языков), дальше абзацы с таймкодами `[m:ss]`.
- Таймкоды только на уровне абзацев, с точностью до секунды. Пословных нет.
- При превышении лимита отдаётся текст вида «You're calling this API at high volume…» вместо транскрипта — это надо распознавать как ошибку.

## Что сделать

1. Модуль источника `src/transcript/sources/youtubeTranscriptAi.ts`:
   - fetch по video id (+ `lang`, если задан);
   - парсер markdown → `{ title, language, durationSec, availableLanguages, paragraphs: [{ start, text }] }`; таймкоды `[m:ss]` и `[h:mm:ss]`;
   - ошибки с понятными кодами: `rate_limited`, `not_found` / `no_captions`, `network`, `parse`;
   - сохрани реальный ответ сервиса для 1–2 видео в `src/transcript/__fixtures__/` (если упрёшься в лимит — зафиксируй это в отчёте, не выдумывай формат).

2. Нормализация `src/transcript/normalize.ts` → единый формат `TranscriptSegment { start: number; end: number; text: string; approximate: boolean }`:
   - конец абзаца = начало следующего; у последнего — длительность видео;
   - абзац делим на предложения (`Intl.Segmenter`, granularity `sentence`), время внутри абзаца распределяем пропорционально длине текста, `approximate: true`;
   - сегменты из сервера (yt-dlp, есть `words`) — `approximate: false`, их время не трогаем.

3. Выбор источника `src/transcript/loadTranscript.ts`: сначала youtube-transcript.ai, при ошибке — `POST {VITE_API_URL}/youtube/subtitles`. Указывать, какой источник сработал. Результат сохраняется в существующее поле транскрипта видео в плейлисте, повторно не запрашивается.

4. Часы плеера — хук `src/player/usePlayerClock.ts` поверх YouTube IFrame API:
   - подписка на `onReady`, `onStateChange`, `onPlaybackRateChange`;
   - на `requestAnimationFrame` читаем `getCurrentTime()` (это «reported time»);
   - интерполяция: только если state = PLAYING и reported time менялось за последнюю секунду; `time = lastReported + (now - lastReportedAt) * playbackRate`; не уходить дальше чем на 1 с от lastReported;
   - BUFFERING / PAUSED / ENDED / CUED, а также «PLAYING, но время не растёт > 1 с» (реклама, подвисание) → замораживаем на reported time;
   - скачок reported time больше 1.5 с вперёд или любой назад → событие seek, сброс интерполяции;
   - наружу: `{ time, state, playbackRate, lastSeekAt }`.
   Логику интерполяции вынеси в чистые функции (`src/player/clock.ts`), чтобы тестировать без браузера.

5. Панель транскрипта:
   - активный сегмент — бинарный поиск по `start`, подсветка;
   - автоскролл к активному, но если пользователь сам прокручивал список последние 5 с — не дёргать; кнопка «к текущему» (иконка прицела уже есть);
   - клик по сегменту → `seekTo(start, true)`;
   - для `approximate` сегментов — ненавязчивая пометка «≈» в UI;
   - поиск по транскрипту и кнопка копирования — сохранить, если уже есть.

6. Отладочная панель (только при `?debug=1`) под плеером, НЕ поверх iframe:
   - reported time, interpolated time, state, playbackRate;
   - интервалы между изменениями reported time: min / avg / max за последние 30 с;
   - счётчик и лог seek-событий, заморозок (buffering / stall);
   - расхождение interpolated − reported в момент каждого нового reported (drift): avg / max.

7. Тесты: добавь vitest (если нет). Тесты на парсер (по фикстурам), нормализацию (распределение времени, границы), `clock.ts` (интерполяция, заморозка, seek, скорость 0.5/1.5).

## Ручная проверка (с `?debug=1`) и отчёт
Прогони на 2–3 видео (стендап, видео с рекламой) и запиши цифры в `docs/PLAN.md`, раздел «Плеер — замеры»:
1. Обычное воспроизведение: интервал обновлений reported time (min/avg/max), drift.
2. Перемотка через таймлайн YouTube — через сколько мс подсветка встала на верный сегмент.
3. Скорость 0.5 и 1.5.
4. DevTools → Network → Slow 3G: поведение при буферизации.
5. Видео с рекламой: что отдают `getPlayerState` / `getCurrentTime` во время рекламы, не «убегает» ли подсветка.
6. Сколько запросов к youtube-transcript.ai прошло до лимита (если упрёшься).

## Не делать
- Не менять сервер и схему БД.
- Не класть элементы поверх iframe, не прятать интерфейс YouTube.
- Не выдумывать формат ответа API — только по реальным ответам.

В конце пришли: список изменённых файлов, результат тестов, цифры замеров п.1–6, какие источники сработали на каких видео.
