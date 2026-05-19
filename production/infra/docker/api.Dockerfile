# Multi-stage build for the NestJS API.
FROM node:20-alpine AS deps
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json tsconfig.base.json ./
COPY apps/api/package.json ./apps/api/
COPY packages ./packages
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm --filter @bloomoulu/db run generate
RUN pnpm --filter @bloomoulu/api run build

FROM node:20-alpine AS runner
WORKDIR /app/apps/api
RUN apk add --no-cache libc6-compat openssl curl
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
# pnpm workspaces install package-local symlinks under apps/api/node_modules
# pointing into /app/node_modules/.pnpm. Copy BOTH or `node` can't resolve
# direct dependencies like @nestjs/core.
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/packages /app/packages
COPY --from=build /app/package.json /app/package.json
COPY --from=build /app/pnpm-workspace.yaml /app/pnpm-workspace.yaml
COPY --from=build /app/apps/api/dist ./dist
COPY --from=build /app/apps/api/node_modules ./node_modules
COPY --from=build /app/apps/api/package.json ./package.json
ENV NODE_ENV=production
# Workspace packages (@bloomoulu/payments, @bloomoulu/db, …) expose their
# entry points at raw `src/*.ts` so dev can run via tsx. The compiled
# Nest dist re-imports them by name, so the runner needs tsx in the loader
# chain to resolve those .ts files.
ENV NODE_OPTIONS="--import tsx"
EXPOSE 4000
# No Dockerfile-level HEALTHCHECK: this image is the build for BOTH `api`
# (HTTP server on :4000) and `api-worker` (BullMQ consumer, no HTTP port).
# A `/healthz` probe baked into the image would falsely mark the worker
# unhealthy. Compose defines per-service healthchecks instead.
CMD ["node", "dist/main.js"]
