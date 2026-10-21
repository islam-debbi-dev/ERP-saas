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
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
# Download packages from the lockfile alone: this layer survives source edits.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm fetch
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile --offline
RUN pnpm turbo run build --filter=@erp/web...

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
# Next.js standalone output keeps the monorepo layout.
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /repo/apps/web/public ./apps/web/public
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
