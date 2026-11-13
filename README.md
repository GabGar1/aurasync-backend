# AuraSync — API

API de gestão para lojas da **Nuvemshop**: sincroniza pedidos e produtos, controla o estoque, calcula o **custo e o lucro de cada venda** (inclusive vendas feitas fora da loja, como em feiras) e alimenta um painel de indicadores em tempo real.

Painel (front-end): [aurasync-admin-portal](https://github.com/GabGar1/aurasync-admin-portal)

![Painel do AuraSync com dados de demonstração](https://raw.githubusercontent.com/GabGar1/aurasync-admin-portal/main/docs/screenshots/dashboard.png)

## O que a API resolve

| Problema da loja | Como o AuraSync resolve |
|---|---|
| Saber o lucro real de cada venda | Motor de custos: custo do produto + embalagem, taxas, frete e taxa de parcelamento, congelados no pedido. Custos fixos do mês (contador, anúncios) são rateados no **fechamento mensal**. |
| Vender em feira sem perder o controle | **Venda externa** com o mesmo cálculo de custo, prévia ao vivo antes de registrar e baixa de estoque. |
| Estoque que não bate | **Uma regra só**: todo pedido (Nuvemshop, manual ou externo) movimenta o estoque pela diferença entre o que deveria reter e o que já movimentou. Reprocessar um pedido não desconta duas vezes; cancelar devolve. |
| Pedidos chegando a qualquer hora | **Webhook** da Nuvemshop validado por HMAC, idempotente, mais **sync incremental** com retry em 429. |
| Indicadores confiáveis | Painel por período no fuso da loja (America/São_Paulo), com comparação com o período anterior. |

## Arquitetura

```mermaid
flowchart LR
  NS[Nuvemshop] -- "webhook {store_id, event, id}\nHMAC x-linkedstore-hmac-sha256" --> WH[/api/webhooks/]
  NS -- "REST: sync incremental\n(updated_at_min, retry 429)" --- SYNC[nuvemshopService]
  WH --> SYNC
  SYNC -- mapper único --> SVC[Services]
  PANEL[Painel React] -- "REST + cookie httpOnly + CSRF" --> R[Routers Fastify]
  R --> SVC
  SVC --> REPO[Repositories Knex]
  REPO --> PG[(PostgreSQL)]
  SVC -- "orders_updated / products_updated" --> WS[WebSocket]
  WS --> PANEL
```

Camadas estritas: **Router** (HTTP, validação Zod) → **Service** (regras de negócio) → **Repository** (único lugar com SQL). Erros de domínio (`NotFoundError`, `ConflictError`…) viram o status HTTP certo num handler global.

### Decisões que valem a leitura

- **Estoque reconciliado por pedido** — [`stock.repository.ts`](src/repositories/stock.repository.ts). A fonte da verdade é o AuraSync; pedidos da Nuvemshop podem deixar o estoque negativo (vendido além do estoque) em vez de serem recusados, porque a venda já aconteceu.
- **Custos congelados no pedido** — [`cost-engine.ts`](src/lib/cost-engine.ts) e [`monthly-cost-engine.ts`](src/lib/monthly-cost-engine.ts). Mudar um custo hoje não reescreve o lucro de vendas antigas.
- **Sessão revogável** — o JWT carrega `token_version`; logout, troca/redefinição de senha e desativação derrubam a sessão na hora. A função do usuário vem sempre do banco.
- **Webhook realista** — a Nuvemshop manda só identificadores; a API busca o registro atual e grava pelo mesmo mapper do sync, então reentregas e eventos fora de ordem são inofensivos.
- **Tempo da loja** — relatórios e fechamento cortam o dia à meia-noite de São Paulo ([`store-time.ts`](src/lib/store-time.ts)).

## Rodando localmente

Pré-requisitos: Node 22, Docker.

```bash
docker compose up -d          # PostgreSQL 15 em 127.0.0.1:5433
cp .env.example .env          # ajuste JWT_SECRET, CSRF_SECRET e DB_SEED_*
npm ci
npm run db:migrate
npm run db:seed               # cria o superadministrador de DB_SEED_EMAIL
npm run dev                   # http://localhost:3333 (Swagger em /docs fora de produção)
```

### Loja de demonstração

Para ver o sistema com dados (6 meses de pedidos de uma loja fictícia de joias com cristais), sem tocar no seu banco:

```bash
DATABASE_URL=postgresql://admin:admin@127.0.0.1:5433/aurasync_demo \
DEMO_PASSWORD='escolha-uma-senha' \
npm run db:seed:demo
```

O script só roda em bancos cujo nome termina em `_demo` (ele zera esse banco), cria o banco se precisar e escreve tudo pelos serviços reais. Usuários: `demo@aurasync.dev` (superadministrador) e `funcionario@aurasync.dev`, com a senha de `DEMO_PASSWORD`.

## Qualidade

```bash
npm run check      # lint + typecheck + testes
```

- **298 testes** de integração com PostgreSQL real (banco `aurasync_test`, criado e migrado pelo `pretest`; o banco de dev nunca é tocado). A integração com a Nuvemshop é testada contra um servidor fake por HTTP real.
- TypeScript `strict` com `exactOptionalPropertyTypes` e `noUncheckedIndexedAccess`.
- CI no GitHub Actions: lint, typecheck, testes com Postgres e build da imagem Docker.

## API

| Grupo | Prefixo |
|---|---|
| Autenticação e sessão | `/api/auth` |
| Usuários | `/api/users` |
| Produtos e sync | `/api/products` |
| Pedidos, cancelamento e sync | `/api/orders` |
| Estoque | `/api/inventory` |
| Venda externa e prévia | `/api/external-sales` |
| Clientes | `/api/customers` |
| Custos, subgrupos, taxas de crédito, fechamento | `/api/cost-components`, `/api/product-subgroups`, `/api/credit-fee-tiers`, `/api/cost-closing` |
| Painel | `/api/dashboard/{orders,marketing,stock}` |
| Webhook da Nuvemshop | `/api/webhooks/nuvemshop` |
| Saúde | `/api/health` |

Documentação interativa (Swagger) em `/docs` quando `NODE_ENV` não é `production`.

## Configuração

| Variável | Para quê |
|---|---|
| `DATABASE_URL` | Conexão do PostgreSQL |
| `JWT_SECRET`, `CSRF_SECRET` | Assinatura da sessão e do token CSRF |
| `ALLOWED_ORIGINS` | Origens do painel (CORS); obrigatória em produção |
| `NUVEMSHOP_STORE_ID`, `NUVEMSHOP_ACCESS_TOKEN` | Acesso à API da loja |
| `NUVEMSHOP_WEBHOOK_SECRET` | Client secret do app (valida o HMAC dos webhooks) |
| `RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW` | Limite global por IP (login tem limite próprio) |
| `DB_SEED_EMAIL`, `DB_SEED_PASSWORD` | Superadministrador criado pelo `db:seed` |

Veja [`.env.example`](.env.example). Deploy em VPS com Docker e Caddy: [`deploy/README.md`](deploy/README.md).

## Stack

Node 22 · TypeScript · Fastify 5 · Knex · PostgreSQL 15 · Zod · WebSocket (`ws`) · `node:test`
