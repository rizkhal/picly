# Picly backend (Hono) — in-app update service
# Build: docker build -f packages/backend/Dockerfile -t picly-backend .
FROM oven/bun:1.3-alpine AS build

WORKDIR /app
COPY packages/backend/package.json packages/backend/bun.lock* ./
RUN bun install --frozen-lockfile

COPY packages/backend/src ./src

# Minimal runtime image (only the compiled/run deps)
FROM oven/bun:1.3-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/src ./src

# Auth DB (users + refresh tokens) — persisted via Docker volume
RUN mkdir -p /data
ENV DB_PATH=/data/picly.db

EXPOSE 9999
CMD ["bun", "run", "src/index.ts"]
