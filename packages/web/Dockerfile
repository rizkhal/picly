# Picly landing page (web) — static site served via nginx
# Build: docker build -f packages/web/Dockerfile -t picly-web .
FROM oven/bun:1.3-alpine AS build

WORKDIR /app
COPY packages/web/package.json packages/web/bun.lock* ./
RUN bun install --frozen-lockfile

COPY packages/web/ ./
RUN bun run build

# Static runtime (nginx) — serves the built dist/
FROM nginx:1.27-alpine AS runtime
COPY packages/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
