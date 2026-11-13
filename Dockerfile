# syntax=docker/dockerfile:1

# ---- deps: reproducible install from the lockfile ----------------------------
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# ---- check: the image is not built if the code does not type-check -----------
FROM deps AS check
COPY tsconfig.json knexfile.ts ./
COPY src ./src
RUN npm run typecheck

# ---- runtime -----------------------------------------------------------------
# The API and the migrations run TypeScript through tsx (knexfile uses .ts
# migrations and the deploy script runs `npm run db:migrate` inside this image),
# so the runtime keeps the full dependency set.
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3333

RUN addgroup -S app && adduser -S app -G app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=check /app/package.json /app/package-lock.json /app/tsconfig.json /app/knexfile.ts ./
COPY --from=check /app/src ./src
USER app

EXPOSE 3333
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/api/health" >/dev/null || exit 1

CMD ["npm", "run", "start"]
