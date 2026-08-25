# Checklist: Colocar o AuraSync no ar (VPS)

> Guia passo a passo para verificar/consertar cada parte do deploy. Rode os
> comandos NA VPS, na ordem. Cada etapa diz o que é **esperado** e o que
> **mudar** se não bater.

Estado atual: DNS propagado, painel no ar (`HTTP/2 200`), API no ar
(`HTTP/2 401` em `/api/auth/me`). Restam: login do frontend (bug do `baseURL`
no `api.ts` — ver `docs/prompts/frontend-prod-integration.md`), teste de
WebSocket e limpeza dos containers antigos.

---

## 1. DNS propagado

```bash
dig +short aurasync.gabrielgarbrecht.dev.br
dig +short aurasync-api.gabrielgarbrecht.dev.br
```

**Esperado:** `178.156.207.205` nos dois.

**Se não bater:** aguardar propagação (domínio novo no registro.br pode levar
horas) e seguir para as etapas 2–4 enquanto isso.

---

## 2. Repo do backend sincronizado

```bash
cd /opt/stack/aurasync-api && git status && git log --oneline -1
```

**Esperado:** `On branch develop`, working tree limpo, último commit
`21127e8 feat(deploy): pacote de deploy do AuraSync na VPS ...`.

**Se não bater:**

```bash
git fetch origin && git checkout develop && git reset --hard origin/develop
```

> ⚠️ `reset --hard` descarta mudanças locais no repo. O `.env.aurasync` NÃO é
> afetado (é ignorado pelo git).

---

## 3. Arquivo de segredos `.env.aurasync`

```bash
cat /opt/stack/aurasync-api/deploy/.env.aurasync
```

**Esperado (criado pelo script no 1º run):** `JWT_SECRET`, `CSRF_SECRET`,
`POSTGRES_PASSWORD`, `DB_SEED_PASSWORD` com hex aleatórios (não `change-me`).
`DATABASE_URL` aponta para `postgres:5432/aurasync`.

**O que MUDAR agora** (nano no arquivo):

| Variável | Valor |
|---|---|
| `NUVEMSHOP_STORE_ID` | ID da loja Nuvemshop |
| `NUVEMSHOP_ACCESS_TOKEN` | Token de acesso |
| `NUVEMSHOP_WEBHOOK_SECRET` | Segredo para validar webhooks |
| `DB_SEED_EMAIL` | Seu email de admin |
| `DB_SEED_PASSWORD` | Senha do admin (opcional; o script gerou uma aleatória) |

**Importante:** `JWT_SECRET`/`CSRF_SECRET` devem ser **diferentes** de
`change-me*`/`dev-*` (o `assertSecureConfig` da API derruba o boot se forem).
O script já gera aleatórios — só não os sobrescreva.

Depois de editar → reexecutar o script (etapa 5), que preserva o arquivo.

---

## 4. Containers do AuraSync

```bash
docker ps | grep aurasync
```

**Esperado:** `aurasync_db` (Up, healthy) e `aurasync_api` (Up).

> ⚠️ Podem aparecer containers ANTIGOS de um deploy de 3 meses:
> `aurasync_backend` (Restarting em loop) e `aurasync_postgres` (Up). Eles são
> lixo de um deploy anterior — remover na etapa 15.

**Se API estiver "Restarting"/"Exited":**

```bash
docker logs aurasync_api --tail 50
```

**Causas comuns e o que mudar:**
- `JWT_SECRET/CSRF_SECRET is required in production` → erro de segredo no
  `.env.aurasync` (etapa 3).
- `ECONNREFUSED postgres:5432` → Postgres ainda inicializando; esperar e
  reexecutar o script.

---

## 4b. Redes docker (causa do 502 da API)

A API e o Caddy precisam estar **na mesma rede docker**, senão o Caddy dá 502
mesmo com a API Up. O compose `aurasync` já conecta a API à rede `stack_default`
(externa, onde o Caddy vive) — confirme:

```bash
docker inspect aurasync_api --format '{{json .NetworkSettings.Networks}}'
```

**Esperado:** as redes `aurasync_aurasync_net` (interna, postgres) e
`stack_default` (onde o Caddy alcança).

**Testar a resolução de dentro do Caddy:**

```bash
docker exec stack-caddy-1 wget -qO- --timeout=5 http://aurasync_api:3333/api/auth/me
```

**Esperado:** resposta HTTP 401 (não "bad address" nem timeout). O bloco
`aurasync-api.{$DOMAIN}` no Caddyfile usa `reverse_proxy aurasync_api:3333`
(nome do container — NUNCA `127.0.0.1:3333`, que dentro do container do Caddy
é ele mesmo).

---

## 5. Migrações e seed (rodar de novo após editar env)

```bash
docker compose -f /opt/stack/aurasync-api/deploy/docker-compose.aurasync.yml exec -T api npm run db:migrate
docker compose -f /opt/stack/aurasync-api/deploy/docker-compose.aurasync.yml exec -T api npm run db:seed
```

**Esperado:** migrações `Already up to date` e seed `Superadmin created: <email>`
(ou `already exists — skipping`).

---

## 6. Frontend buildado

```bash
ls /opt/stack/aurasync-frontend/dist | head
```

**Esperado:** `index.html` + assets (`assets/`, `vite.svg` etc).

**Se não existir** — rebuild manual:

```bash
docker run --rm -v /opt/stack/aurasync-frontend:/app -w /app \
  -e VITE_API_URL="https://aurasync-api.gabrielgarbrecht.dev.br/api" \
  node:20-alpine sh -c "npm ci --no-audit --no-fund && npm run build"
```

> Se o painel não falar com a API, confira que o `VITE_API_URL` bate com o
> subdomínio real da API. Para rebuildar com outro valor, apague o `dist` e
> repita o comando acima.

---

## 7. Caddyfile: blocos AuraSync

```bash
grep -n "AURASYNC" /opt/stack/caddy/Caddyfile
# se não achar, procure: find /opt/stack -maxdepth 2 -name Caddyfile
```

**Esperado:** marcadores `# === AURASYNC START ===` e `# === AURASYNC END ===`
com os blocos `aurasync.{$DOMAIN}` e `aurasync-api.{$DOMAIN}` entre eles.

**Se não bater:** o script insere automaticamente ao rodar (etapa 9). Para
inserir manual, siga o fragmento em
`/opt/stack/aurasync-api/deploy/Caddyfile.aurasync.fragment` — coloque o
conteúdo entre os marcadores no fim do Caddyfile.

---

## 8. Variável `{$DOMAIN}` dentro do container do Caddy

```bash
docker exec stack-caddy-1 env | grep -i DOMAIN
```

**Esperado:** `DOMAIN=gabrielgarbrecht.dev.br` (ou similar, SEM `aurasync.`).

**Se NÃO aparecer** — este é o provável causador do erro de TLS: os blocos
`aurasync.{$DOMAIN}` viram `aurasync.` (domínio vazio) e o Caddy não consegue
emitir certificado. **O que mudar:** no compose raiz `/opt/stack/docker-compose.yml`,
o serviço `caddy` precisa de `environment: DOMAIN=...` (ou `env_file`). Adicione
e recrie:

```bash
docker compose up -d caddy
```

---

## 9. Reexecutar o deploy (idempotente)

```bash
bash /opt/stack/aurasync-api/deploy/deploy-aurasync.sh
```

**Esperado:** logs das fases, terminando com "Deploy concluído!". O script
agora **recria o container do Caddy** (`--force-recreate`) em vez de só fazer
reload.

> ⚠️ **Por quê:** o `sed -i`/edição do Caddyfile no host **troca o inode** do
> arquivo. O bind mount do Docker fixa o inode da criação do container — se o
> arquivo foi substituído, `caddy reload` lê a versão velha e loga
> `"config is unchanged"`. Só recriar o container (`docker compose up -d
> --force-recreate caddy`) atualiza o mount. Não edite o Caddyfile com `sed -i`
> depois que o container estiver de pé — prefira o script.

---

## 10. Montar o `dist` no container do Caddy

```bash
docker inspect stack-caddy-1 --format '{{json .Mounts}}' | grep -o 'aurasync-frontend/dist'
```

**Esperado:** o caminho aparece (mount do dist).

**Se NÃO aparecer** — **O que mudar** em `/opt/stack/docker-compose.yml`, no
serviço `caddy`, na seção `volumes:`:

```yaml
    volumes:
      - /opt/stack/aurasync-frontend/dist:/opt/stack/aurasync-frontend/dist:ro
```

(adicione a linha, mantendo os volumes já existentes). Depois:

```bash
docker compose up -d caddy
```

---

## 11. HTTPS funcionando (painel + API)

```bash
curl -sI https://aurasync.gabrielgarbrecht.dev.br | head -3
curl -sI https://aurasync-api.gabrielgarbrecht.dev.br | head -3
```

**Esperado:** `HTTP/2 200` no painel; na API `HTTP/2 200`/`404`/`401` (qualquer
resposta HTTP do Caddy, NUNCA 502 nem timeout de TLS).

**Se der erro de TLS** → volta para etapa 8 (`{$DOMAIN}`) e confira os logs:

```bash
docker logs stack-caddy-1 --tail 40
```

**Se der 502** → checar o erro real no log do Caddy (ele mostra o endereço
tentado — ex: `dial tcp 172.17.0.1:3333` = config velha; `bad address
aurasync_api` = redes separadas):

```bash
docker logs stack-caddy-1 --tail 40 | grep -A 2 "http.log.error"
```

- Erro com `host.docker.internal`/`127.0.0.1` → config velha no mount (etapa 9).
- Erro com `aurasync_api` → redes não compartilhadas (etapa 4b).

**Se der 404 na API** → normal (rota não existe); teste uma real:
`curl -s https://aurasync-api.gabrielgarbrecht.dev.br/api/auth/me -H "Origin: https://aurasync.gabrielgarbrecht.dev.br" -i | head -10`
(esperado: 401 `{error: ...}` — sinal de que a API responde).

---

## 12. Login no navegador

Abrir `https://aurasync.gabrielgarbrecht.dev.br` → login com
`DB_SEED_EMAIL` + `DB_SEED_PASSWORD` do `.env.aurasync`.

**Esperado:** entra no dashboard (cookie JWT `aurasync_token` + CSRF).

**Se o login falhar com erro de CORS** → **O que mudar** em `.env.aurasync`:
`ALLOWED_ORIGINS=https://aurasync.gabrielgarbrecht.dev.br` (já está no example;
confirme que não foi sobrescrito). Depois reexecutar o script.

---

## 13. WebSocket (dashboard em tempo real)

Com o painel logado, abrir DevTools → Network → WS → `wss://aurasync-api.gabrielgarbrecht.dev.br`.
**Esperado:** conexão aberta, sem erros.

**Se falhar:** o Caddy repassa upgrade automaticamente; confirmar que a API
está no ar e o cookie JWT está sendo enviado.

---

## 14. (Opcional) Webhooks Nuvemshop

No painel da Nuvemshop, apontar o webhook para:
`https://aurasync-api.gabrielgarbrecht.dev.br/api/webhooks/nuvemshop`
com o `NUVEMSHOP_WEBHOOK_SECRET` do `.env.aurasync`.

---

## 15. Limpeza de containers antigos (deploy de 3 meses atrás)

A VPS tem resquícios de um deploy anterior:
- `aurasync_backend` — container Restarting em loop (desperdício de CPU)
- `aurasync_postgres` — Postgres velho (dados de outro DB, portas 5432 interno)
- bloco `api.{$DOMAIN}` → `reverse_proxy aurasync_backend:3333` no Caddyfile
  (aponta pra um container morto)

> ⚠️ Antes de remover, confirme que NINGUÉM usa o `aurasync_postgres` (dados
> antigos podem existir). Os dados do deploy NOVO ficam no volume
> `aurasync_pgdata` do compose atual — não são afetados.

```bash
# 1. Parar e remover o backend velho (Restarting em loop)
docker rm -f aurasync_backend

# 2. Postgres velho — SÓ se não precisar dos dados antigos
docker rm -f aurasync_postgres

# 3. Remover o bloco morto do Caddyfile (api.{$DOMAIN} → aurasync_backend)
#    e recriar o Caddy para o mount pegar o inode novo:
sed -i '/^api\.{\$DOMAIN} {/,/^}/d' /opt/stack/caddy/Caddyfile
docker compose up -d --force-recreate caddy

# 4. Conferir o Caddyfile limpo
grep -n "AURASYNC\|aurasync_backend" /opt/stack/caddy/Caddyfile
```

**Esperado:** só os marcadores `AURASYNC` aparecem; nenhuma referência a
`aurasync_backend`; `docker ps | grep aurasync` mostra apenas `aurasync_db` e
`aurasync_api`.

---

## Resumo: o que mudar em cada arquivo

| Arquivo | Mudança | Quando |
|---|---|---|
| `/opt/stack/aurasync-api/deploy/.env.aurasync` | `NUVEMSHOP_*`, `DB_SEED_EMAIL`, (senha) | 1ª vez (nunca commitado) |
| `/opt/stack/aurasync-api/deploy/docker-compose.aurasync.yml` | API na rede `stack_default` (já está); só se porta 5433 ocupada → trocar bind | se necessário |
| `/opt/stack/docker-compose.yml` | volume `dist` no serviço caddy; `extra_hosts` NÃO é mais necessário | 1ª vez (etapa 10) |
| `/opt/stack/docker-compose.yml` | `environment: DOMAIN=...` no caddy | se `{$DOMAIN}` vazio (etapa 8) |
| `/opt/stack/caddy/Caddyfile` | blocos AURASYNC com `reverse_proxy aurasync_api:3333` | automático (script); NÃO usar `sed -i` no Caddyfile |

**Nunca editar:** `JWT_SECRET`, `CSRF_SECRET`, `POSTGRES_PASSWORD` depois do
1º run (quebram sessões/boot). Backups do Caddyfile ficam em
`/opt/stack/caddy/Caddyfile.bak.*` (rollback).
