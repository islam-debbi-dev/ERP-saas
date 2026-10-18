# Build from the repo root: docker build -f apps/api/Dockerfile .
FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm turbo run build --filter=@erp/api...
RUN pnpm --filter @erp/api deploy --prod --legacy /out

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out .
EXPOSE 3001
# Apply pending migrations, then start. Migrations are backward compatible (AGENTS.md §7).
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
