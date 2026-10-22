# Build from the repo root: docker build -f apps/api/Dockerfile .
FROM node:22-alpine AS base
RUN corepack enable
# Shared download cache (BuildKit) and patient fetches, so a slow or flaky network
# doesn't restart the whole install. pnpm 11 reads pnpm_config_*, not npm_config_*.
ENV pnpm_config_store_dir=/pnpm/store \
    pnpm_config_fetch_retries=5 \
    pnpm_config_fetch_timeout=120000 \
    pnpm_config_network_concurrency=8
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
# Git sha of this build: /health reports it and Sentry tags events with it.
ARG SENTRY_RELEASE=dev
ENV SENTRY_RELEASE=$SENTRY_RELEASE
WORKDIR /app
COPY --from=build /out .
# Root owns the code; the server runs as the unprivileged node user.
USER node
EXPOSE 3001
HEALTHCHECK --interval=15s --timeout=3s --start-period=30s --retries=5 \
  CMD wget -qO- http://127.0.0.1:3001/health >/dev/null || exit 1
# Migrations are a separate step before the deploy (the migrate service, run as the DB
# owner): this server connects as erp_app, which can't change the schema.
CMD ["node", "dist/main.js"]
