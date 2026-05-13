FROM node:20-alpine AS deps
WORKDIR /app
RUN apk add --no-cache libc6-compat openssl
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json tsconfig.base.json ./
COPY apps/admin/package.json ./apps/admin/
COPY packages ./packages
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm --filter @bloomoulu/db run generate
RUN pnpm --filter @bloomoulu/admin run build

FROM node:20-alpine AS runner
WORKDIR /app
RUN apk add --no-cache libc6-compat openssl curl
COPY --from=build /app/apps/admin/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/admin/package.json ./
ENV NODE_ENV=production
EXPOSE 4100
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD curl -fsS http://localhost:4100/admin/health || exit 1
CMD ["node", "dist/server.js"]
