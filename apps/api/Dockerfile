# Build from the repo root: docker build -f apps/api/Dockerfile .
FROM node:22-alpine AS base
RUN corepack enable
# Shared download cache (BuildKit) and patient fetches, so a slow or flaky network
# doesn't restart the whole install.
ENV npm_config_store_dir=/pnpm/store \
    npm_config_fetch_retries=5 \
    npm_config_fetch_timeout=120000 \
    npm_config_network_concurrency=8
WORKDIR /repo

FROM base AS build
# The runtime image uses Alpine's Chromium; don't download puppeteer's own browser.
ENV PUPPETEER_SKIP_DOWNLOAD=true
# Download packages from the lockfile alone: this layer survives source edits.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm fetch
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile --offline
RUN pnpm turbo run build --filter=@erp/api...
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm --filter @erp/api deploy --prod --legacy --prefer-offline /out

FROM node:22-alpine AS runtime
# Headless Chromium + fonts for server-side PDFs (same output on every machine).
# Packages are kept in a BuildKit cache and the install is retried: on a slow or
# flaky network each attempt keeps what already arrived instead of starting over.
RUN --mount=type=cache,id=apk-cache,target=/var/cache/apk \
    ln -s /var/cache/apk /etc/apk/cache && \
    for i in 1 2 3 4 5 6 7 8; do \
      apk add chromium nss freetype harfbuzz ttf-dejavu font-noto && exit 0; \
      echo "apk add failed (attempt $i), retrying"; sleep 10; \
    done; exit 1
ENV NODE_ENV=production
ENV CHROMIUM_PATH=/usr/bin/chromium-browser
WORKDIR /app
COPY --from=build /out .
EXPOSE 3001
# Apply pending migrations, then start. Migrations are backward compatible (AGENTS.md §7).
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
