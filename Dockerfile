# Multi-stage build for Sentinel
FROM node:22-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml ./

FROM base AS build
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
COPY . .
# Build only the main service TypeScript (API/worker image does not need delivery build)
RUN pnpm exec tsc

FROM base AS prod-deps
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --prod --frozen-lockfile

FROM node:22-alpine AS runner
WORKDIR /app
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001
# Use dumb-init to handle kernel signals (PID 1 issue)
RUN apk add --no-cache dumb-init
USER nodejs

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/src/db/schema.sql ./schema.sql

ENV NODE_ENV=production
EXPOSE 3000

# Use dumb-init to properly handle SIGINT/SIGTERM
ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "dist/api/index.js"]
