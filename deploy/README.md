# Deploy AuraSync na VPS

Este diretório contém o pacote de deploy do AuraSync (painel + API) para a VPS,
executado por um agente (humano ou IA) diretamente no servidor.

## Topologia

```
gabrielgarbrecht.dev.br            → portfólio (futuro, NÃO é tocado)
aurasync.gabrielgarbrecht.dev.br   → painel (frontend estático via Caddy)
aurasync-api.gabrielgarbrecht.dev.br → API (reverse_proxy do Caddy → aurasync_api:3333)

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
