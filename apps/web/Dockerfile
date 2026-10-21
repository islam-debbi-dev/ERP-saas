# Build from the repo root: docker build -f apps/web/Dockerfile .
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
# Baked into the browser bundle. /api (same origin, behind Caddy) keeps one image for
# staging and production; an absolute URL is for running without the proxy.
ARG NEXT_PUBLIC_API_URL=/api
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
# Browser error reporting (empty = off) and the git sha it is tagged with.
ARG NEXT_PUBLIC_SENTRY_DSN=
ARG NEXT_PUBLIC_SENTRY_RELEASE=
ENV NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN \
    NEXT_PUBLIC_SENTRY_RELEASE=$NEXT_PUBLIC_SENTRY_RELEASE
# Download packages from the lockfile alone: this layer survives source edits.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm fetch
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile --offline
RUN pnpm turbo run build --filter=@erp/web...

FROM node:22-alpine AS runtime
ARG NEXT_PUBLIC_SENTRY_RELEASE=
ENV NODE_ENV=production
ENV SENTRY_RELEASE=$NEXT_PUBLIC_SENTRY_RELEASE
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
WORKDIR /app
# Next.js standalone output keeps the monorepo layout.
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /repo/apps/web/public ./apps/web/public
# Next.js writes its cache at runtime; everything else stays owned by root.
RUN mkdir -p apps/web/.next/cache && chown -R node:node apps/web/.next/cache
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=5 \
  CMD wget -qO- http://127.0.0.1:3000/login >/dev/null || exit 1
CMD ["node", "apps/web/server.js"]
