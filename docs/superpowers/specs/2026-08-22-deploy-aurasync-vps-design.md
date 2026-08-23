# Deploy AuraSync na VPS — Design

Data: 2026-08-22
Status: aprovado (desenho validado com o usuário durante brainstorming)

## Objetivo

Publicar o AuraSync (backend + painel admin) na VPS do usuário sob o domínio
`gabrielgarbrecht.dev.br`, em subdomínios dedicados, usando a infraestrutura
existente (Caddy via docker compose em `/opt/stack`). O domínio raiz fica
reservado para um futuro site de portfólio (fora do escopo deste deploy).

## Decisões (validadas com o usuário)

| Decisão | Escolha |
|---|---|
| Subdomínio do painel | `aurasync.gabrielgarbrecht.dev.br` |
| Subdomínio da API | `aurasync-api.gabrielgarbrecht.dev.br` |
| Proxy reverso | Caddy (já rodando em `/opt/stack`, TLS automático Let's Encrypt) |
| Runtime do backend | Docker compose (`postgres:15` + API Fastify) |
| Frontend | Build no host (Vite → `dist/`), servido estático pelo Caddy |
| Banco | Novo Postgres 15 no compose do AuraSync, bind `127.0.0.1` |
| Acesso à VPS | Scripts versionados no repo; usuário executa na VPS |
| Portfólio na raiz | Fora do escopo — o script NÃO toca no bloco `{$DOMAIN}` atual do Caddyfile |

## Arquitetura

```
VPS /opt/stack/
├── aurasync-api/                ← git pull (branch develop)
├── aurasync-frontend/           ← git clone GabGar1/aurasync-admin-portal (main)
├── docker-compose.aurasync.yml  ← postgres:15 + api (backend)
├── .env.aurasync                ← segredos (fora do repo, criado na 1ª execução)
└── deploy-aurasync.sh           ← script idempotente

DNS (registro.br, já propagado):
  gabrielgarbrecht.dev.br          A/AAAA → 178.156.207.205 / 2a01:4ff:f0:6fbf::1 (portfólio futuro)
  aurasync.gabrielgarbrecht.dev.br A/AAAA → idem  (painel)
  aurasync-api.gabrielgarbrecht.dev.br A/AAAA → idem (API)

Caddy:
  aurasync.{$DOMAIN}      → root /opt/stack/aurasync-frontend/dist (file_server + SPA fallback)
  aurasync-api.{$DOMAIN}  → reverse_proxy 127.0.0.1:3333

API container:
  PORT=3333, HOST=0.0.0.0, NODE_ENV=production, TRUST_PROXY=true,
  ALLOWED_ORIGINS=https://aurasync.gabrielgarbrecht.dev.br
```

## Componentes entregues no repo (pasta `deploy/`)

1. **`deploy/docker-compose.aurasync.yml`** — serviços `postgres` (postgres:15-alpine,
   volume `aurasync_pgdata`, porta `127.0.0.1:5433`) e `api` (build do `Dockerfile`
   do repo, `restart: unless-stopped`, env via `.env.aurasync`, expõe `127.0.0.1:3333`).
2. **`deploy/deploy-aurasync.sh`** — script idempotente:
   - `git pull` em `aurasync-api` (develop) e `aurasync-frontend` (main)
   - cria `.env.aurasync` a partir de `.env.aurasync.example` se não existir
   - `docker compose -f docker-compose.aurasync.yml up -d --build`
   - `npm ci && npm run build` no frontend
   - `db:migrate` + `db:seed` dentro do container da API
   - insere blocos `# === AURASYNC ===` no Caddyfile se ausentes (marcadores) e
     recarrega o Caddy (`docker exec` com `caddy reload`)
3. **`deploy/.env.aurasync.example`** — espelho do `.env.example` + variáveis do
   compose (POSTGRES_*, ALLOWED_ORIGINS, TRUST_PROXY=true, HOST=0.0.0.0).
4. **`deploy/Caddyfile.aurasync.fragment`** — blocos `aurasync.{$DOMAIN}` e
   `aurasync-api.{$DOMAIN}` prontos para o script inserir no Caddyfile existente.
5. **`deploy/README.md`** — passo a passo (DNS, secrets, execução, rollback).

## Notas técnicas importantes

- **Backend**: roda via `tsx src/server.ts` (sem build TS — Dockerfile já reflete
  isso). Requer `HOST=0.0.0.0` dentro do container.
- **Cookie JWT + CSRF**: exige `ALLOWED_ORIGINS` com o domínio do painel e
  `TRUST_PROXY=true` (Caddy faz proxy).
- **WebSocket**: mesmo servidor HTTP (porta 3333) — `reverse_proxy` do Caddy
  repassa upgrade automaticamente; sem config extra.
- **Swagger**: exposto em `/docs` quando `NODE_ENV != production`; em produção
  fica oculto (comportamento atual do `server.ts`).
- **Seed**: `db:seed` cria o usuário SUPER_ADMIN (`DB_SEED_EMAIL`/`DB_SEED_PASSWORD`
  no `.env.aurasync`).
- **Caddyfile atual** usa a variável `{$DOMAIN}` e bloco placeholder na raiz —
  o script insere apenas os blocos AuraSync, sem remover nada existente.
- **Nuvemshop**: se o usuário configurar webhooks de produção, apontar para
  `https://aurasync-api.gabrielgarbrecht.dev.br/api/webhooks/nuvemshop`.

## Fora de escopo

- Site de portfólio na raiz (`gabrielgarbrecht.dev.br`) — projeto futuro.
- Configuração de webhooks Nuvemshop em produção.
- CI/CD automático — o script é executado manualmente na VPS.
- Nginx — não existe na VPS; o proxy é o Caddy.

## Verificação (critérios de aceite)

- [ ] `https://aurasync.gabrielgarbrecht.dev.br` serve o painel (build do frontend)
- [ ] `https://aurasync-api.gabrielgarbrecht.dev.br` responde (ex: `GET /docs` retorna 404 em produção — o teste real é o login abaixo; `curl -sI` retorna HTTP válido do Caddy)
- [ ] Login no painel funciona (cookie JWT + CSRF)
- [ ] WebSocket conecta (dashboard em tempo real)
- [ ] `docker compose ps` mostra postgres + api Up
- [ ] Segredos não estão no repo (`.env.aurasync` ignorado)
