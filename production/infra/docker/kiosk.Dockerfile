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
# NEXT_PUBLIC_* are inlined into the client bundle by `next build`, so they must
# be set at BUILD time — a runtime env has no effect on the already-built bundle.
# Defaults keep `pnpm dev` working; compose passes the public ngrok URLs so the
# kiosk's API calls + home/ask QR links resolve to the real host.
ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ARG NEXT_PUBLIC_WEB_URL=http://localhost:3000
ARG NEXT_PUBLIC_KIOSK_URL=http://localhost:3100
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_WEB_URL=$NEXT_PUBLIC_WEB_URL \
    NEXT_PUBLIC_KIOSK_URL=$NEXT_PUBLIC_KIOSK_URL
RUN pnpm --filter @bloomoulu/kiosk run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/apps/kiosk/.next/standalone ./
COPY --from=build /app/apps/kiosk/.next/static ./apps/kiosk/.next/static
COPY --from=build /app/apps/kiosk/public ./apps/kiosk/public
EXPOSE 3100
CMD ["node", "apps/kiosk/server.js"]
