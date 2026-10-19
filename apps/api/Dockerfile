# Build from the repo root: docker build -f apps/api/Dockerfile .
FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /repo

FROM base AS build
# The runtime image uses Alpine's Chromium; don't download puppeteer's own browser.
ENV PUPPETEER_SKIP_DOWNLOAD=true
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm turbo run build --filter=@erp/api...
RUN pnpm --filter @erp/api deploy --prod --legacy /out

FROM node:22-alpine AS runtime
# Headless Chromium + fonts for server-side PDFs (same output on every machine).
RUN apk add --no-cache chromium nss freetype harfbuzz ttf-dejavu font-noto
ENV NODE_ENV=production
ENV CHROMIUM_PATH=/usr/bin/chromium-browser
WORKDIR /app
COPY --from=build /out .
EXPOSE 3001
# Apply pending migrations, then start. Migrations are backward compatible (AGENTS.md §7).
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
