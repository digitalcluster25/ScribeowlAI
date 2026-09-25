FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends python3 python-is-python3 ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && npm install -g pnpm@10.33.2

WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

EXPOSE 3000
CMD ["node", "server.mjs"]
