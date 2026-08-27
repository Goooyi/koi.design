# syntax=docker/dockerfile:1.7

FROM node:24-bookworm-slim AS build

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable && corepack prepare pnpm@11.21.0 --activate

WORKDIR /workspace

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json vite.config.ts ./
COPY apps ./apps
COPY packages ./packages

RUN --mount=type=cache,id=koi-pnpm,target=/pnpm/store pnpm install --frozen-lockfile
RUN pnpm build

FROM node:24-bookworm-slim AS runtime

ENV HOST=0.0.0.0
ENV KOI_DATA_DIR=/data
ENV KOI_STATIC_DIR=/app/web
ENV NODE_ENV=production
ENV PORT=8787

WORKDIR /app

COPY --from=build --chown=node:node /workspace/apps/server/dist/main.js ./server.js
COPY --from=build --chown=node:node /workspace/apps/web/dist ./web

RUN mkdir -p /data && chown node:node /data

USER node

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8787/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]

CMD ["node", "/app/server.js"]
