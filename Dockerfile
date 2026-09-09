# syntax=docker/dockerfile:1

FROM node:20-slim AS base
RUN corepack enable
WORKDIR /app

# ---- build ----
FROM base AS build
COPY frontend/ frontend/
WORKDIR /app/frontend
# vendor/* are plain local packages (file: deps, no pnpm workspace) — each
# needs its own install + build before the frontend can import their dist/.
RUN for pkg in ui utils embed-react; do \
      (cd vendor/$pkg && pnpm install --no-frozen-lockfile && pnpm build); \
    done
RUN pnpm install --no-frozen-lockfile
ENV NEXT_TELEMETRY_DISABLED=1
# Next.js build for this app (hundreds of routes) exceeds V8's default ~2GB
# old-space limit inside a container; raise it explicitly.
ENV NODE_OPTIONS=--max-old-space-size=4096
RUN pnpm prisma:generate
RUN pnpm build

# ---- runtime ----
FROM node:20-slim AS runner
RUN corepack enable
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=build /app/frontend /app/frontend
WORKDIR /app/frontend

EXPOSE 3000
CMD ["pnpm", "start"]
