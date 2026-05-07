FROM node:20-alpine AS builder

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY tsconfig.json ./
COPY src ./src
RUN pnpm build

# ---- runtime ----
FROM node:20-alpine

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile && \
    addgroup -S app && adduser -S app -G app && \
    mkdir -p /app/logs /app/tokens && chown -R app:app /app

COPY --from=builder /app/dist ./dist
COPY SECURITY.md README.md ./

USER app

ENV NODE_ENV=production

ENTRYPOINT ["node", "dist/index.js"]
