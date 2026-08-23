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
