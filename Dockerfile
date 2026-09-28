# Frontend (Vite SPA) → статика в nginx. Переменные VITE_* подставляются при сборке (как локально из .env.local),
# в CI — из GitHub Secrets (см. .github/workflows/stage.yml).
FROM node:24-bookworm-slim AS deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@12.6.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# CI: docker build --target test .
FROM deps AS test
COPY . .
RUN pnpm vitest run

FROM deps AS build
ARG VITE_API_URL
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_PUBLISHABLE_KEY
COPY . .
RUN test -n "$VITE_API_URL" && test -n "$VITE_SUPABASE_URL" && test -n "$VITE_SUPABASE_PUBLISHABLE_KEY" \
  || { echo "VITE_API_URL / VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY are required" >&2; exit 1; }
RUN pnpm build

FROM nginx:1.29-alpine AS runtime
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/healthz >/dev/null || exit 1
