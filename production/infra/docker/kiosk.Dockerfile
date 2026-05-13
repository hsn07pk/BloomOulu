FROM node:20-alpine AS deps
WORKDIR /app
RUN apk add --no-cache libc6-compat
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json tsconfig.base.json ./
COPY apps/kiosk/package.json ./apps/kiosk/
COPY packages ./packages
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm --filter @bloomoulu/db run generate || true
RUN pnpm --filter @bloomoulu/kiosk run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/apps/kiosk/.next/standalone ./
COPY --from=build /app/apps/kiosk/.next/static ./apps/kiosk/.next/static
COPY --from=build /app/apps/kiosk/public ./apps/kiosk/public
EXPOSE 3100
CMD ["node", "apps/kiosk/server.js"]
