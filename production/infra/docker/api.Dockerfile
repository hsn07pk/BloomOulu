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
WORKDIR /app
RUN apk add --no-cache libc6-compat openssl curl
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
COPY --from=build /app/apps/api/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/api/package.json ./
ENV NODE_ENV=production
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD curl -fsS http://localhost:4000/healthz || exit 1
CMD ["node", "dist/main.js"]
