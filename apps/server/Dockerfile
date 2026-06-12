FROM node:24-bookworm-slim AS builder

WORKDIR /app

RUN npm install -g pnpm

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared-types/package.json ./packages/shared-types/
COPY apps/server/package.json ./apps/server/

RUN pnpm install --frozen-lockfile

COPY . .

RUN pnpm --filter @codver/shared-types build
RUN pnpm --filter @codver/server build

FROM node:24-bookworm-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    gh \
    ca-certificates \
    curl \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

COPY --from=builder /app/apps/server/dist ./dist
COPY --from=builder /app/apps/server/package.json ./
COPY --from=builder /app/apps/server/node_modules ./node_modules
COPY --from=builder /app/packages/shared-types/dist ./node_modules/@codver/shared-types

RUN mkdir -p /app/data /app/certs

RUN useradd -m -u 1000 codver && chown -R codver:codver /app

USER codver

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

CMD ["node", "dist/index.js"]
