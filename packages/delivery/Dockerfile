# Build stage
FROM node:20-alpine AS builder

WORKDIR /app
ENV NODE_ENV=development

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy package files
COPY package.json pnpm-lock.yaml* ./

# Install dependencies (force dev deps so `tsc` is available for build)
RUN pnpm install --no-frozen-lockfile --config.production=false \
  && test -f node_modules/typescript/bin/tsc

# Copy source
COPY . .

# Build
RUN pnpm build

# Production stage
FROM node:20-alpine

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy package files
COPY package.json pnpm-lock.yaml* ./

# Install production dependencies only
RUN pnpm install --prod --no-frozen-lockfile

# Copy built files
COPY --from=builder /app/dist ./dist

# Run
ENV NODE_ENV=production
EXPOSE 3100

CMD ["node", "dist/index.js"]
