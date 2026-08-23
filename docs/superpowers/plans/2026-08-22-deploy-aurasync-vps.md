# Deploy AuraSync na VPS — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Criar o pacote `deploy/` no repo do backend que permite subir o AuraSync (painel + API + Postgres) na VPS do usuário usando o Caddy já existente em `/opt/stack`.

**Architecture:** O pacote contém 5 arquivos: um `docker-compose.aurasync.yml` (postgres:15 + API), um `.env.aurasync.example` (segredos fora do repo), um fragmento de Caddyfile, um script `deploy-aurasync.sh` idempotente que um agente de IA executa na VPS, e um `README.md` com instruções para o agente executor. O script sincroniza repos, sobe containers, roda migrações/seed, builda o frontend via container node e insere/recarrega blocos no Caddyfile existente.

**Tech Stack:** bash, Docker Compose v2, Node 20 (container `node:20-alpine` para build do frontend), Caddy v2 (já em produção), Vite (build do frontend), Fastify (API, já containerizada pelo `Dockerfile` do repo).

## Global Constraints

- Endereços: painel `aurasync.gabrielgarbrecht.dev.br`, API `aurasync-api.gabrielgarbrecht.dev.br` (DNS já propagado).
- VPS: backend em `/opt/stack/aurasync-api` (branch `develop`), frontend em `/opt/stack/aurasync-frontend` (branch `main`).
- Caddyfile existente da VPS usa placeholder `{$DOMAIN}` e fica em `/opt/stack` (host). O script NÃO remove nada existente — só adiciona blocos entre marcadores `# === AURASYNC START ===` / `# === AURASYNC END ===`.
- Segredos: `.env.aurasync` fica na VPS, nunca no repo. `.env.aurasync.example` é versionado.
- API: `NODE_ENV=production`, `TRUST_PROXY=true`, `ALLOWED_ORIGINS=https://aurasync.gabrielgarbrecht.dev.br`, `HOST=0.0.0.0`, `PORT=3333`.
- `assertSecureConfig` (src/lib/config.ts) rejeita segredos começando com `change-me`/`dev-` em produção — o script gera segredos aleatórios no primeiro run.
- Backend roda `tsx src/server.ts` (sem build TS — não mudar isso).
- VITE_API_URL é sobreposta por variável de ambiente no build (Vite prioriza env real sobre `.env`).
- Nome de projeto compose: `aurasync` (evita conflito com o stack raiz `/opt/stack`).
- Postgres bind no host: `127.0.0.1:5433`.

---

### Task 1: `deploy/docker-compose.aurasync.yml`

**Files:**
- Create: `deploy/docker-compose.aurasync.yml`

**Interfaces:**
- Produces: compose com serviços `postgres` e `api`; consome `deploy/.env.aurasync` (via `env_file`); a API usa o `Dockerfile` na raiz do repo (`build.context = ..`). O Task 4 (script) referencia este arquivo.

- [ ] **Step 1: Criar o arquivo**

```yaml
name: aurasync

services:
  postgres:
    image: postgres:15-alpine
    container_name: aurasync_db
    env_file:
      - .env.aurasync
    ports:
      - "127.0.0.1:5433:5432"
    volumes:
      - aurasync_pgdata:/var/lib/postgresql/data
    restart: unless-stopped
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U $$POSTGRES_USER -d $$POSTGRES_DB"]
      interval: 5s
      timeout: 5s
      retries: 10

  api:
    build:
      context: ..
      dockerfile: Dockerfile
    container_name: aurasync_api
    env_file:
      - .env.aurasync
    depends_on:
      postgres:
        condition: service_healthy
    ports:
      - "127.0.0.1:3333:3333"
    restart: unless-stopped

volumes:
  aurasync_pgdata:
```

- [ ] **Step 2: Validar o YAML**

Run: `docker compose -f deploy/docker-compose.aurasync.yml config > /dev/null`
Expected: saída limpa (sem erro), exit 0. O `env_file` ausente não impede `config` de validar.

- [ ] **Step 3: Commit**

```bash
git add deploy/docker-compose.aurasync.yml
git commit -m "feat(deploy): docker-compose do AuraSync (postgres + api)"
```

---

### Task 2: `deploy/.env.aurasync.example` + `.gitignore`

**Files:**
- Create: `deploy/.env.aurasync.example`
- Modify: `.gitignore` (adicionar `!.env.aurasync.example` após a linha `!.env.example`)

**Interfaces:**
- Produces: template copiado pelo script (Task 4) para `deploy/.env.aurasync`. Valores `change-me-*` são substituídos por segredos aleatórios na primeira execução do script.

- [ ] **Step 1: Criar o example**

```
PORT=3333
HOST=0.0.0.0
NODE_ENV=production
TRUST_PROXY=true
JWT_SECRET=change-me-to-a-random-secret
CSRF_SECRET=change-me-to-another-random-secret

DATABASE_URL=postgresql://admin:admin@postgres:5432/aurasync

NUVEMSHOP_STORE_ID=
NUVEMSHOP_ACCESS_TOKEN=
NUVEMSHOP_WEBHOOK_SECRET=

DB_SEED_EMAIL=admin@aurasync.com
DB_SEED_PASSWORD=change-me-to-a-strong-password

POSTGRES_DB=aurasync
POSTGRES_USER=admin
POSTGRES_PASSWORD=admin

ALLOWED_ORIGINS=https://aurasync.gabrielgarbrecht.dev.br
```

- [ ] **Step 2: Atualizar `.gitignore`**

Adicionar logo após a linha `!.env.example`:

```
!.env.aurasync.example
```

- [ ] **Step 3: Verificar que o example é versionável e o `.env.aurasync` é ignorado**

Run:
```bash
git check-ignore deploy/.env.aurasync.example; echo "ignored=$? (1 = NÃO ignorado, correto)"
git check-ignore deploy/.env.aurasync
```
Expected: primeiro comando exit 1 (arquivo NÃO ignorado — será versionado); segundo mostra o path (ignorado).

- [ ] **Step 4: Commit**

```bash
git add deploy/.env.aurasync.example .gitignore
git commit -m "feat(deploy): template de env do AuraSync (segredos fora do repo)"
```

---

### Task 3: `deploy/Caddyfile.aurasync.fragment`

**Files:**
- Create: `deploy/Caddyfile.aurasync.fragment`

**Interfaces:**
- Produces: fragmento inserido pelo script (Task 4) no Caddyfile do host, entre os marcadores. Usa `{$DOMAIN}` (variável já usada no Caddyfile existente da VPS).

- [ ] **Step 1: Criar o fragmento**

```
aurasync.{$DOMAIN} {
        encode zstd gzip
        root * /opt/stack/aurasync-frontend/dist
        try_files {path} /index.html
        file_server

        header {
                Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"
                X-Content-Type-Options "nosniff"
                Referrer-Policy "no-referrer"
        }
}

aurasync-api.{$DOMAIN} {
        encode zstd gzip
        reverse_proxy 127.0.0.1:3333 {
                header_up X-Real-IP {remote_host}
                header_up X-Forwarded-For {remote_host}
        }

        header {
                Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"
                X-Content-Type-Options "nosniff"
                Referrer-Policy "no-referrer"
        }
}
```

- [ ] **Step 2: Commit**

```bash
git add deploy/Caddyfile.aurasync.fragment
git commit -m "feat(deploy): fragmento de Caddyfile para aurasync + aurasync-api"
```

---

### Task 4: `deploy/deploy-aurasync.sh`

**Files:**
- Create: `deploy/deploy-aurasync.sh`

**Interfaces:**
- Consumes: `docker-compose.aurasync.yml` (Task 1), `.env.aurasync.example` (Task 2), `Caddyfile.aurasync.fragment` (Task 3).
- Produces: `deploy/.env.aurasync` (secrets, primeira execução), containers `aurasync_db` + `aurasync_api`, `dist/` do frontend, blocos no Caddyfile + reload do Caddy.

- [ ] **Step 1: Criar o script**

```bash
#!/usr/bin/env bash
set -euo pipefail

# ============================================================================
# deploy-aurasync.sh — deploy idempotente do AuraSync (backend + painel) na VPS
#
# Uso: bash /opt/stack/aurasync-api/deploy/deploy-aurasync.sh
#
# O que faz:
#   1. Sincroniza o backend (aurasync-api) com a branch develop
#   2. Clona/atualiza o frontend (aurasync-frontend) na branch main
#   3. Cria .env.aurasync a partir do example (apenas no 1º run, com segredos)
#   4. Sobe postgres + api via docker compose (nome de projeto: aurasync)
#   5. Roda migrações e seed (idempotentes)
#   6. Builda o frontend dentro de container node:20-alpine
#   7. Insere blocos AuraSync no Caddyfile do host e recarrega o Caddy
# ============================================================================

DOMAIN_FRONT="aurasync.gabrielgarbrecht.dev.br"
DOMAIN_API="aurasync-api.gabrielgarbrecht.dev.br"
FRONTEND_REPO_URL="https://github.com/GabGar1/aurasync-admin-portal.git"
BACKEND_BRANCH="develop"
FRONTEND_BRANCH="main"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(dirname "$SCRIPT_DIR")"
STACK_DIR="$(dirname "$BACKEND_DIR")"
FRONTEND_DIR="$STACK_DIR/aurasync-frontend"
ENV_FILE="$SCRIPT_DIR/.env.aurasync"
ENV_EXAMPLE="$SCRIPT_DIR/.env.aurasync.example"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.aurasync.yml"
FRAGMENT_FILE="$SCRIPT_DIR/Caddyfile.aurasync.fragment"
MARKER_START="# === AURASYNC START ==="
MARKER_END="# === AURASYNC END ==="

log() { printf '\n\033[1;36m>>> %s\033[0m\n' "$*"; }
die() { printf '\033[1;31mERRO: %s\033[0m\n' "$*" >&2; exit 1; }

command -v docker >/dev/null || die "docker não encontrado no PATH"
command -v git >/dev/null || die "git não encontrado no PATH"
command -v openssl >/dev/null || die "openssl não encontrado no PATH"
command -v awk >/dev/null || die "awk não encontrado no PATH"

# ---------------------------------------------------------------- backend ---
log "Sincronizando backend em $BACKEND_DIR (branch $BACKEND_BRANCH)"
git -C "$BACKEND_DIR" fetch origin
git -C "$BACKEND_DIR" checkout "$BACKEND_BRANCH"
git -C "$BACKEND_DIR" reset --hard "origin/$BACKEND_BRANCH"

# --------------------------------------------------------------- frontend ---
if [ ! -d "$FRONTEND_DIR/.git" ]; then
  log "Clonando frontend em $FRONTEND_DIR"
  git clone --branch "$FRONTEND_BRANCH" "$FRONTEND_REPO_URL" "$FRONTEND_DIR"
else
  log "Atualizando frontend em $FRONTEND_DIR (branch $FRONTEND_BRANCH)"
  git -C "$FRONTEND_DIR" fetch origin
  git -C "$FRONTEND_DIR" checkout "$FRONTEND_BRANCH"
  git -C "$FRONTEND_DIR" reset --hard "origin/$FRONTEND_BRANCH"
fi

# ---------------------------------------------------------------- env file ---
if [ ! -f "$ENV_FILE" ]; then
  log "Criando $ENV_FILE a partir do example (segredos aleatórios)"
  cp "$ENV_EXAMPLE" "$ENV_FILE"
  PG_PASS="$(openssl rand -hex 16)"
  JWT_SECRET="$(openssl rand -hex 32)"
  CSRF_SECRET="$(openssl rand -hex 32)"
  SEED_PASS="$(openssl rand -hex 16)"
  sed -i \
    -e "s|^JWT_SECRET=.*|JWT_SECRET=$JWT_SECRET|" \
    -e "s|^CSRF_SECRET=.*|CSRF_SECRET=$CSRF_SECRET|" \
    -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$PG_PASS|" \
    -e "s|^DATABASE_URL=.*|DATABASE_URL=postgresql://admin:$PG_PASS@postgres:5432/aurasync|" \
    -e "s|^DB_SEED_PASSWORD=.*|DB_SEED_PASSWORD=$SEED_PASS|" \
    "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  log "ATENÇÃO: edite $ENV_FILE e configure NUVEMSHOP_* e DB_SEED_EMAIL"
else
  log "$ENV_FILE já existe — mantendo"
fi

# ------------------------------------------------------------- compose up ---
log "Subindo postgres + api (docker compose)"
docker compose -f "$COMPOSE_FILE" up -d --build

log "Rodando migrações"
docker compose -f "$COMPOSE_FILE" exec -T api npm run db:migrate

log "Rodando seed (idempotente)"
docker compose -f "$COMPOSE_FILE" exec -T api npm run db:seed

# ------------------------------------------------------------ build front ---
log "Buildando frontend em $FRONTEND_DIR"
docker run --rm -v "$FRONTEND_DIR:/app" -w /app \
  -e VITE_API_URL="https://$DOMAIN_API/api" \
  node:20-alpine sh -c "npm ci --no-audit --no-fund && npm run build"

[ -d "$FRONTEND_DIR/dist" ] || die "Build do frontend não gerou $FRONTEND_DIR/dist"

# ---------------------------------------------------------------- caddy ---
CADDY_CONTAINER="$(docker ps --format '{{.Names}}' | grep -i caddy | head -n1 || true)"
[ -n "$CADDY_CONTAINER" ] || die "Container do Caddy não encontrado (docker ps)"

CADDY_HOST_FILE="$(find "$STACK_DIR" -maxdepth 2 -name Caddyfile -type f 2>/dev/null | head -n1 || true)"
[ -n "$CADDY_HOST_FILE" ] || die "Caddyfile não encontrado em $STACK_DIR"

if ! grep -q "$MARKER_START" "$CADDY_HOST_FILE"; then
  log "Inserindo blocos AuraSync em $CADDY_HOST_FILE"
  cp "$CADDY_HOST_FILE" "$CADDY_HOST_FILE.bak.$(date +%s)"
  printf '\n%s\n' "$MARKER_START" >> "$CADDY_HOST_FILE"
  cat "$FRAGMENT_FILE" >> "$CADDY_HOST_FILE"
  printf '%s\n' "$MARKER_END" >> "$CADDY_HOST_FILE"
else
  log "Blocos AuraSync já presentes no Caddyfile"
fi

CADDY_INNER_FILE="$(
  docker inspect "$CADDY_CONTAINER" --format '{{range .Mounts}}{{.Source}}|{{.Destination}}{{println}}{{end}}' \
  | awk -F'|' -v f="$CADDY_HOST_FILE" '$1==f {print $2; exit}'
)"
CADDY_INNER_FILE="${CADDY_INNER_FILE:-/etc/caddy/Caddyfile}"

log "Recarregando Caddy ($CADDY_CONTAINER) com config $CADDY_INNER_FILE"
docker exec "$CADDY_CONTAINER" caddy reload --config "$CADDY_INNER_FILE"

# ------------------------------------------------------- aviso de mount ---
if ! docker inspect "$CADDY_CONTAINER" --format '{{json .Mounts}}' | grep -q 'aurasync-frontend/dist'; then
  cat <<EOF

ATENÇÃO: o diretório de build do frontend NÃO está montado no container do Caddy.
Para o painel https://$DOMAIN_FRONT funcionar, adicione no serviço "caddy" do
compose raiz (/opt/stack/docker-compose.yml) o seguinte volume (ro):

      - /opt/stack/aurasync-frontend/dist:/opt/stack/aurasync-frontend/dist:ro

e depois recrie o container:

      docker compose up -d caddy

(O root * do bloco aurasync no Caddyfile já usa esse caminho.)
EOF
fi

# ---------------------------------------------------------------- done ---
log "Deploy concluído!"
cat <<EOF

Acessos:
  Painel: https://$DOMAIN_FRONT
  API:    https://$DOMAIN_API
  Swagger: indisponível em produção (NODE_ENV=production)

Próximos passos:
  1. Edite $ENV_FILE: NUVEMSHOP_STORE_ID, NUVEMSHOP_ACCESS_TOKEN,
     NUVEMSHOP_WEBHOOK_SECRET e DB_SEED_EMAIL (depois rode o script de novo;
     o .env já existente é preservado).
  2. Confira o aviso de montagem do dist no Caddy (se apareceu acima).
  3. Verifique https://$DOMAIN_FRONT (certificado Let's Encrypt sai automático).
EOF
```

- [ ] **Step 2: Verificar sintaxe**

Run: `bash -n deploy/deploy-aurasync.sh`
Expected: sem saída, exit 0.

- [ ] **Step 3: Tornar executável e validar com shellcheck se disponível**

Run:
```bash
chmod +x deploy/deploy-aurasync.sh
command -v shellcheck >/dev/null && shellcheck deploy/deploy-aurasync.sh || echo "shellcheck ausente (ok)"
```
Expected: sem erros de shellcheck (ou aviso de ausência). Correções de shellcheck se apontadas.

- [ ] **Step 4: Commit**

```bash
git add deploy/deploy-aurasync.sh
git commit -m "feat(deploy): script idempotente de deploy na VPS (caddy + compose)"
```

---

### Task 5: `deploy/README.md`

**Files:**
- Create: `deploy/README.md`

**Interfaces:**
- Produces: instruções completas para o agente executor (outra IA) rodar o deploy na VPS, incluindo o passo manual da montagem do `dist` no container do Caddy e o checklist de verificação do spec.

- [ ] **Step 1: Criar o README**

```markdown
# Deploy AuraSync na VPS

Este diretório contém o pacote de deploy do AuraSync (painel + API) para a VPS,
executado por um agente (humano ou IA) diretamente no servidor.

## Topologia

```
gabrielgarbrecht.dev.br            → portfólio (futuro, NÃO é tocado)
aurasync.gabrielgarbrecht.dev.br   → painel (frontend estático via Caddy)
aurasync-api.gabrielgarbrecht.dev.br → API (reverse_proxy do Caddy → 127.0.0.1:3333)

/opt/stack/
├── aurasync-api/          ← este repo (branch develop)
├── aurasync-frontend/     ← repo GabGar1/aurasync-admin-portal (branch main)
├── docker-compose.yml     ← compose raiz da VPS (Caddy, n8n, mongo, gotenberg)
├── caddy/Caddyfile        ← Caddyfile do host (pode estar em /opt/stack/caddy ou /opt/stack)
└── aurasync-api/deploy/   ← este pacote
```

## Pré-requisitos na VPS

- Docker + docker compose plugin
- git, openssl, awk (todos já presentes na VPS)
- DNS dos subdomínios apontando para a VPS (A + AAAA) — já configurado no
  registro.br para `gabrielgarbrecht.dev.br`, `aurasync.*`, `aurasync-api.*`.

## Execução

```bash
cd /opt/stack/aurasync-api
git fetch origin && git checkout develop && git reset --hard origin/develop
bash deploy/deploy-aurasync.sh
```

O script é idempotente — pode ser re-executado para atualizar tudo. Na primeira
execução ele cria `deploy/.env.aurasync` com segredos aleatórios (JWT, CSRF,
Postgres, seed).

## Pós-deploy obrigatório (1ª vez)

1. **Configurar o `.env.aurasync`** — o script preserva o arquivo em execuções
   seguintes, mas você precisa editar uma vez:

   ```bash
   nano /opt/stack/aurasync-api/deploy/.env.aurasync
   ```

   Ajuste: `NUVEMSHOP_STORE_ID`, `NUVEMSHOP_ACCESS_TOKEN`,
   `NUVEMSHOP_WEBHOOK_SECRET`, `DB_SEED_EMAIL` (e `DB_SEED_PASSWORD` se quiser
   algo memorizável). Depois reexecute o script.

2. **Montar o `dist/` do frontend no container do Caddy** (o script avisa se
   faltar). No compose raiz `/opt/stack/docker-compose.yml`, no serviço `caddy`,
   adicione o volume:

   ```yaml
   volumes:
     - /opt/stack/aurasync-frontend/dist:/opt/stack/aurasync-frontend/dist:ro
   ```

   E recrie o container:

   ```bash
   docker compose up -d caddy
   ```

## Verificação (checklist de aceite)

```bash
# 1. Containers do AuraSync
docker compose -f /opt/stack/aurasync-api/deploy/docker-compose.aurasync.yml ps

# 2. Painel responde (cadeado SSL)
curl -sI https://aurasync.gabrielgarbrecht.dev.br | head -5

# 3. API responde (qualquer rota retorna JSON de erro/auth, NÃO 502)
curl -sI https://aurasync-api.gabrielgarbrecht.dev.br | head -5

# 4. Login no painel no navegador (cookie JWT + CSRF funcionam)
# 5. WebSocket conecta (dashboard em tempo real — o Caddy repassa upgrade sozinho)
```

## Rollback

```bash
# Remover containers AuraSync (dados do Postgres ficam no volume aurasync_pgdata)
docker compose -f /opt/stack/aurasync-api/deploy/docker-compose.aurasync.yml down

# Remover blocos do Caddyfile (backup criado pelo script: Caddyfile.bak.<ts>)
# Restaurar backup: cp Caddyfile.bak.<ts> Caddyfile && docker exec <caddy> caddy reload --config /etc/caddy/Caddyfile
```

## Troubleshooting

- **DNS recém-criado no registro.br não propaga**: domínios novos podem levar
  horas; o serial da zona (SOA) sobe a cada save, mas a publicação atrasa.
  Verificar: `dig +short aurasync.gabrielgarbrecht.dev.br` (deve mostrar o IPv4).
- **502 Bad Gateway na API**: API fora do ar — `docker logs aurasync_api`.
- **Certificado SSL pendente**: o Caddy emite automaticamente quando o DNS
  resolve; aguardar alguns minutos e recarregar (`docker exec <caddy> caddy reload`).
- **Porta 5433 ocupada**: outra instância de Postgres no host; troque o bind no
  `docker-compose.aurasync.yml` (ex: `127.0.0.1:5434:5432`) e ajuste nada no
  `.env.aurasync` (a API usa a rede interna do compose, não o bind do host).
- **Painel não carrega depois do build**: confira a montagem do `dist` no Caddy
  (item 2 do pós-deploy) e `docker logs` do container caddy.
```

- [ ] **Step 2: Commit**

```bash
git add deploy/README.md
git commit -m "docs(deploy): README com instruções de execução na VPS"
```

---

### Task 6: Verificação final do pacote

**Files:**
- Nenhum novo — valida o pacote inteiro.

**Interfaces:**
- Consumes: Tasks 1–5.

- [ ] **Step 1: Rodar lint do repo**

Run: `npm run lint`
Expected: sem erros novos (deploy/ contém apenas bash/markdown/YAML, fora do escopo do ESLint de `src/`).

- [ ] **Step 2: Validar estrutura final**

Run: `ls -la deploy/`
Expected:

```
Caddyfile.aurasync.fragment
README.md
deploy-aurasync.sh
docker-compose.aurasync.yml
.env.aurasync.example
```

- [ ] **Step 3: Validar compose completo com env de exemplo**

Run:
```bash
cp deploy/.env.aurasync.example /tmp/env-test && \
docker compose -f deploy/docker-compose.aurasync.yml --env-file /tmp/env-test config > /dev/null
```
Expected: exit 0 (o compose resolve com o env de exemplo; o YAML é válido).

- [ ] **Step 4: Commit final se houver pendências**

```bash
git status --short
git log --oneline -8
```

## Self-Review Notes

- Spec coverage: subdomínios (Task 3, README), compose postgres+api (Task 1),
  secrets fora do repo (Task 2, Task 4), build frontend no host via container
  (Task 4), Caddyfile fragmento com marcadores (Task 3, Task 4), script
  idempotente (Task 4), README p/ agente executor (Task 5), rollback e
  troubleshooting (Task 5).
- Placeholder scan: nenhum "TBD/TODO"; todos os passos têm conteúdo completo.
- Type consistency: nomes de serviços (`postgres`, `api`), arquivos e marcadores
  (`# === AURASYNC START ===`) consistentes entre Tasks 1, 3 e 4.
