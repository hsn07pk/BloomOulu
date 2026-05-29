FROM node:20-alpine AS deps
WORKDIR /app
RUN apk add --no-cache libc6-compat
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json tsconfig.base.json ./
COPY apps/web/package.json ./apps/web/
COPY packages ./packages
RUN pnpm install --frozen-lockfile

FROM deps AS build
# NEXT_PUBLIC_* env vars are inlined into client bundles by `next build`,
# so they MUST be set at build time. Pass via --build-arg (docker-compose
# does it via build.args). If not provided we fall back to host-port
# defaults that work for plain `pnpm dev` users.
ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ARG NEXT_PUBLIC_WEB_URL=http://localhost:3000
ARG NEXT_PUBLIC_ADMIN_URL=http://localhost:4100
ARG NEXT_PUBLIC_KIOSK_URL=http://localhost:3100
# API_REWRITE_TARGET drives next.config.mjs rewrites() for /v1/* + /webhooks/*.
# Next.js bakes rewrite destinations into routes-manifest.json at BUILD time
# (output: standalone), so a runtime env has no effect — it must be a build
# arg. In Docker this is http://api:4000 (the api service); default stays
# localhost:4000 for plain `pnpm dev`.
ARG API_REWRITE_TARGET=http://localhost:4000
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_WEB_URL=$NEXT_PUBLIC_WEB_URL \
    NEXT_PUBLIC_ADMIN_URL=$NEXT_PUBLIC_ADMIN_URL \
    NEXT_PUBLIC_KIOSK_URL=$NEXT_PUBLIC_KIOSK_URL \
    API_REWRITE_TARGET=$API_REWRITE_TARGET
COPY . .
RUN pnpm --filter @bloomoulu/db run generate
RUN pnpm --filter @bloomoulu/web run build

FROM node:20-alpine AS runner
WORKDIR /app
# HOSTNAME=0.0.0.0 makes Next.js bind to every interface. Docker sets
# HOSTNAME to the container ID by default, which Next then uses as its
# listen address — so 127.0.0.1:3000 inside the container has nothing
# bound and HEALTHCHECK probes fail with "Connection refused" even
# though the host port still works (because Docker NATs the bridge IP).
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0
RUN apk add --no-cache libc6-compat curl
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001
COPY --from=build --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=nextjs:nodejs /app/apps/web/public ./apps/web/public
USER nextjs
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3000/api/healthz || exit 1
CMD ["node", "apps/web/server.js"]
