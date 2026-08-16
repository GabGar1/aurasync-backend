# AuraSync Backend — Deployment

Both options share the same code. Behavior is controlled by environment variables and `NODE_ENV`.

## Environment variables (all deploy paths)

| Variable | Required | Purpose |
|---|---|---|
| `NODE_ENV` | prod | must be `production` in production |
| `JWT_SECRET` | prod | session signing secret (>=32 random chars) |
| `CSRF_SECRET` | prod | CSRF token HMAC secret (>=32 random chars) |
| `DATABASE_URL` | yes | Postgres DSN |
| `NUVEMSHOP_STORE_ID` | yes | Nuvemshop store id |
| `NUVEMSHOP_ACCESS_TOKEN` | yes | Nuvemshop API token |
| `NUVEMSHOP_WEBHOOK_SECRET` | yes | webhook HMAC secret |
| `ALLOWED_ORIGINS` | no | comma list; default `https://lamata.tec.br` in prod |
| `TRUST_PROXY` | yes | `true` when behind a reverse proxy (needed for secure cookies + rate limit IPs) |
| `HOST` | no | bind address; `0.0.0.0` in Docker, `127.0.0.1` behind a proxy |
| `PORT` | no | default `3333` |

If `NODE_ENV=production` and `JWT_SECRET`/`CSRF_SECRET` are missing or placeholders, the app refuses to start (fail-fast).

## Option A: Docker + TLS reverse proxy (recommended)

1. Copy `.env.example` to `.env` and fill real values (incl. `NODE_ENV=production`, `TRUST_PROXY=true`, `HOST=0.0.0.0`).
2. Build and run the API: `docker build -t aurasync-backend .`
3. Start Postgres: `docker compose up -d`
4. Run migrations/seed against the DB: `npm run db:migrate && npm run db:seed` (with the same `.env`/`DATABASE_URL`)
5. Run the app bound to `0.0.0.0:3333` (Docker container or `npm run start` with the env above).
6. Put Caddy (or nginx) in front with a TLS cert for `lamata.tec.br`, proxying to `127.0.0.1:3333`:
   - Caddy: `lamata.tec.br { reverse_proxy 127.0.0.1:3333 }`
7. Postgres is bound only to `127.0.0.1:5433` (see `docker-compose.yml`).

## Option B: systemd / bare Node + nginx TLS

1. `npm i --legacy-peer-deps` and `cp .env.example .env` with real values (`NODE_ENV=production`, `TRUST_PROXY=true`, `HOST=127.0.0.1`).
2. `npm run db:migrate && npm run db:seed`
3. Run with a process manager (pm2/systemd) executing `npm run start`.
4. nginx: terminate TLS for `lamata.tec.br`, `proxy_pass http://127.0.0.1:3333;`, set
   `proxy_set_header X-Forwarded-Proto $scheme; proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`
   (required because `TRUST_PROXY=true`).

## Webhooks

Nuvemshop must POST to `https://lamata.tec.br/api/webhooks/nuvemshop` with `X-Webhook-Signature: hmac-sha256(secret, body)`.

## Secret rotation

1. Generate a new secret: `openssl rand -hex 32`.
2. Update `JWT_SECRET`/`CSRF_SECRET` in `.env` (all sessions expire; token TTL is 2h).
3. Restart the app; old tokens stop verifying immediately.
4. Rotate `NUVEMSHOP_ACCESS_TOKEN` and `NUVEMSHOP_WEBHOOK_SECRET` in the Nuvemshop dashboard, then update `.env` and restart.
5. Rotate Postgres `POSTGRES_PASSWORD`, update `.env`, recreate the compose env (`docker compose up -d`).

## Post-deploy verification checklist

- [ ] `POST /api/auth/login` works with a real user
- [ ] `GET /docs` returns 404 (hidden in production)
- [ ] `GET /api/products/` without Bearer token returns 401
- [ ] Every response includes `x-content-type-options: nosniff` (curl -I)
- [ ] More than 5 login attempts in 1 minute from one IP return 429
- [ ] WebSocket at `wss://lamata.tec.br` rejects a connection without the session cookie
- [ ] CORS preflight from `https://lamata.tec.br` returns 204 with the right `access-control-allow-origin`