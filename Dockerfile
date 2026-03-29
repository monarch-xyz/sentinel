# Multi-stage build for Sentinel
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml ./

FROM base AS build
RUN pnpm install --frozen-lockfile
COPY . .
# Build only the main service TypeScript (API/worker image does not need delivery build)
RUN pnpm exec tsc

FROM base AS prod-deps
RUN pnpm install --prod --frozen-lockfile

FROM node:22-bookworm-slim AS runner
WORKDIR /app
RUN groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs nodejs \
  && apt-get update \
  && apt-get install -y --no-install-recommends dumb-init \
  && rm -rf /var/lib/apt/lists/*
USER nodejs

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/src/db/migrations ./migrations

ENV NODE_ENV=production
EXPOSE 3000

# Use dumb-init to properly handle SIGINT/SIGTERM
ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "dist/api/index.js"]
