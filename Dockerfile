# syntax=docker/dockerfile:1

# Debian/glibc is shared by build and runtime for Prisma, bcrypt and Sharp binaries.
FROM node:24-bookworm-slim AS runtime-base
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates openssl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM runtime-base AS tooling
RUN npm install --global pnpm@11.25.0
ENV CI=true \
    PNPM_HOME=/pnpm \
    PRISMA_SKIP_POSTINSTALL_GENERATE=true

# Manifests first retain dependency cache when only application sources change.
FROM tooling AS manifests
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY backend/package.json ./backend/package.json
COPY packages/shared/package.json ./packages/shared/package.json
COPY packages/types/package.json ./packages/types/package.json
COPY packages/validation/package.json ./packages/validation/package.json
COPY prisma/schema.prisma ./prisma/schema.prisma

FROM manifests AS api-deps
RUN --mount=type=cache,id=kidquest-pnpm,target=/pnpm/store \
    pnpm --filter @kidquest/backend... install --prod --frozen-lockfile --store-dir /pnpm/store

FROM manifests AS workspace
COPY frontend/package.json ./frontend/package.json
RUN --mount=type=cache,id=kidquest-pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --store-dir /pnpm/store
COPY . .

FROM workspace AS api-build
# This synthetic URL is only used to generate code; builds never connect to a database.
RUN DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build pnpm db:generate
RUN pnpm --filter './packages/**' build \
    && pnpm --filter @kidquest/backend build \
    && node docker/prisma-client.mjs export /app/.generated-prisma-client

# Separate one-shot image: CLI and committed migrations stay out of the API process.
FROM workspace AS migrate
ENV NODE_ENV=production
USER node
CMD ["pnpm", "db:deploy"]

FROM runtime-base AS api
ENV NODE_ENV=production \
    PORT=4000 \
    STORAGE_PATH=/app/storage
COPY --from=api-deps /app/node_modules ./node_modules
COPY --from=api-deps /app/backend/node_modules ./backend/node_modules
COPY --from=api-deps /app/packages ./packages
COPY --from=api-deps /app/backend/package.json ./backend/package.json
COPY --from=api-build /app/backend/dist ./backend/dist
COPY --from=api-build /app/packages/shared/dist ./packages/shared/dist
COPY --from=api-build /app/packages/types/dist ./packages/types/dist
COPY --from=api-build /app/packages/validation/dist ./packages/validation/dist
# pnpm's full and production dependency graphs can have different virtual-store paths.
# Install the generated client beside the actual production @prisma/client package.
RUN --mount=type=bind,from=api-build,source=/app/.generated-prisma-client,target=/tmp/generated-prisma,ro \
    --mount=type=bind,source=docker/prisma-client.mjs,target=/tmp/prisma-client.mjs,ro \
    node /tmp/prisma-client.mjs install /tmp/generated-prisma \
    && install -d -o node -g node -m 0700 /app/storage
USER node
WORKDIR /app/backend
EXPOSE 4000
HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=10 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:4000/api/v1/ready',{signal:AbortSignal.timeout(3000)}).then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "dist/server.js"]

FROM workspace AS web-build
# Only public Firebase Web App configuration is permitted at build time.
ARG VITE_FIREBASE_API_KEY=""
ARG VITE_FIREBASE_PROJECT_ID=""
ARG VITE_FIREBASE_MESSAGING_SENDER_ID=""
ARG VITE_FIREBASE_APP_ID=""
ARG VITE_FIREBASE_VAPID_KEY=""
ENV VITE_FIREBASE_API_KEY=${VITE_FIREBASE_API_KEY} \
    VITE_FIREBASE_PROJECT_ID=${VITE_FIREBASE_PROJECT_ID} \
    VITE_FIREBASE_MESSAGING_SENDER_ID=${VITE_FIREBASE_MESSAGING_SENDER_ID} \
    VITE_FIREBASE_APP_ID=${VITE_FIREBASE_APP_ID} \
    VITE_FIREBASE_VAPID_KEY=${VITE_FIREBASE_VAPID_KEY}
RUN pnpm --filter './packages/**' build \
    && VITE_API_URL=/api/v1 pnpm --filter @kidquest/frontend build

FROM caddy:2.11.7-alpine AS web
COPY docker/Caddyfile /etc/caddy/Caddyfile
COPY --from=web-build /app/frontend/dist /srv
EXPOSE 80 443
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=5 \
    CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
