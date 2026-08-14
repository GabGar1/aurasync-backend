# Motor de Custos v2 — Design Spec

Data: 2026-08-14 · Branch: `develop` (base)

## Purpose

Expandir o motor de custos existente (`cost-engine.ts` + `cost_components`/`product_cost_components`) para suportar o modelo completo de custos do negócio: aquisição por produto, subgrupos de produtos, embalagem com capacidade/consolidação, taxa de crédito por parcelas, custos mensais (equipe, pró-labore, contador, imposto, tráfego pago) com fechamento mensal, custo de feira e frete (já existente).

Princípios herdados do AGENTS.md: **acurácia/rastreabilidade no momento da transação**; snapshot congelado por venda; custos mensais em camada separada.

## Decisões confirmadas com o usuário

1. Custos mensais → **fechamento mensal** (job idempotente), não estimativa na venda.
2. **Subgrupo** = entidade nova; produto pertence a **um** subgrupo; componente associa a subgrupo E/OU produto.
3. **Taxa de crédito** = built-in configurável (`credit_fee_tiers`); mudança de percentual **não retroage** (congelada no snapshot).
4. Mensais fixos → **base de rateio configurável** (`PER_ORDER` | `PER_PRODUCT`).
5. Embalagem → **capacidade + consolidação total** (consolidadora absorve tudo).
6. **Feira** = flag `orders.is_fair` + componente com `applies_to_fair_only`.
7. Fechamento mensal → **tabela separada** `order_monthly_allocations` + total em camadas.
8. Abordagem: **estender o sistema existente** (não reescrever).

## Modelo de dados

### Novas tabelas

| Tabela | Colunas | Propósito |
|---|---|---|
| `product_subgroups` | id uuid PK, name, description, is_active, deleted_at, timestamps | Subgrupo de produto |
| `subgroup_cost_components` | id uuid PK, subgroup_id FK, cost_component_id FK, quantity, timestamps, unique(subgroup_id, cost_component_id) | Associação componente→subgrupo |
| `credit_fee_tiers` | id uuid PK, installments int unique, percent decimal(5,2), fixed_fee decimal(10,2), is_active, deleted_at, timestamps | Taxa de crédito por nº de parcelas |
| `order_monthly_allocations` | id uuid PK, order_id FK, cost_component_id FK, amount decimal(10,2), period_start date, period_end date, timestamps, unique(order_id, cost_component_id, period_start, period_end) | Resultado do fechamento mensal |

### Alterações

- `products` → + `subgroup_id` (uuid nullable, FK `product_subgroups`).
- `orders` → + `is_fair` (boolean default false); + `monthly_cost_total` (decimal(10,2) default 0).
- `cost_components` → novos campos:
  - `type` estendido: `FIXED | PERCENT | PER_ORDER | PACKAGING | MONTHLY_FIXED | MONTHLY_PERCENT`. (Substitui o antigo `MONTHLY`, que era só "controle".)
  - `max_products_per_package` (int, nullable) — capacidade (PACKAGING).
  - `consolidates` (boolean default false) — embalagem consolidadora.
  - `allocation_basis` (enum `PER_ORDER | PER_PRODUCT`, nullable) — rateio (MONTHLY_FIXED).
  - `period_start` / `period_end` (date, nullable) — incidência (tráfego pago).
  - `applies_to_fair_only` (boolean default false) — escopo Feira.
  - `category` estendido com `ACQUISITION`.

### Mapeamento categoria → coluna do snapshot

| category | coluna `unit_*` |
|---|---|
| `ACQUISITION` | `unit_cost` (soma ao custo do produto) |
| `PACKAGING` | `unit_packaging_cost` |
| `TAX` | `unit_tax` |
| `FEE` | `unit_platform_fee` |
| `SHIPPING` | `unit_shipping_cost` |
| `OPERATIONAL` | `unit_operational_cost` |
| `MARKETING` | `unit_marketing_cost` |
| `OTHER` | `unit_other_cost` |
| `CREDIT_FEE` (built-in) | `unit_platform_fee` |

## Catálogo de custos (mapeamento do spec → componente)

| Categoria do spec | `type` | Associação/escopo | Base | Notas |
|---|---|---|---|---|
| Aquisição | `FIXED` | produto E/OU subgrupo | — | soma em `unit_cost`; fallback `variant.cost_price` |
| Embalagem | `PACKAGING` | subgrupo | por pedido | `value`=custo da caixa; `max_products_per_package`; `consolidates` |
| Tráfego pago | `MONTHLY_FIXED` | global | pedido/produto | `period_start/end` (default mês cheio) |
| Equipe / Pró-labore / Contador | `MONTHLY_FIXED` | global | pedido/produto | `allocation_basis` |
| Imposto | `MONTHLY_PERCENT` | global | receita do mês | % sobre `sum(total_amount)` |
| Taxa de crédito | built-in (`credit_fee_tiers`) | global | `total_amount` + fixa | congela no snapshot |
| Feira | `FIXED`/`PER_ORDER` + `applies_to_fair_only` | global | — | só `is_fair=true` |
| Frete | JSON do pedido | — | rateio existente | sem componente |

## Motor por venda (estende `cost-engine.ts`)

Na hora da venda (upsert Nuvemshop E venda externa), calcula e congela:

1. **Aquisição**: componentes `FIXED` do produto + do subgrupo do produto somados em `unit_cost`; sem componente → fallback `variant.cost_price` (comportamento legado).
2. **Componentes por unidade** (`FIXED`, `PERCENT`): como hoje.
3. **Embalagem** (novo):
   - Agrupa itens por `subgroup_id`.
   - Para cada subgrupo, acha o componente `PACKAGING` associado.
   - Se existe componente com `consolidates=true` cujo subgrupo tem ≥1 produto no pedido:
     `caixas = ceil(totalItensDoPedido / capacidade_consolidadora)`; custo = `caixas × value`; demais embalagens zeram.
     (Múltiplos consolidadores: vence o de maior `max_products_per_package`.)
   - Senão: por subgrupo, `caixas = ceil(qtdDoSubgrupo / capacidade)`; custo = `caixas × value`; soma.
   - Custo total de embalagem rateado entre itens por peso (`unit_price × quantity`), dividido por `quantity` na coluna unitária.
4. **Taxa de crédito**: `tier = credit_fee_tiers[installments]` (null→1); `fee = total_amount × percent/100 + fixed_fee`; rateado por peso. Congela.
5. **Feira**: se `is_fair`, aplica componentes `applies_to_fair_only` (`FIXED` por unidade ou `PER_ORDER`).
6. **Frete**: do JSON, rateado (existente).

Congelamento idêntico ao atual: snapshot por variante imutável; re-sync preserva valores congelados; novas variantes ganham custo calculado na hora.

## Fechamento mensal (novo engine)

Endpoint `POST /api/cost-closing` (ADMIN), **idempotente**. Payload `{ month: "YYYY-MM" }` OU `{ start_date, end_date }` (ISO `YYYY-MM-DD`).

Algoritmo:
1. Resolve período: `month` → `[primeiroDia, primeiroDiaDoMêsSeguinte)`; ou `[start_date, end_date + 1 dia)`.
2. Pedidos elegíveis: `deleted_at IS NULL`, `status != CANCELED`, `created_at` dentro do período.
3. Agrega: `revenue = sum(total_amount)`; `orderCount = count`; `productCount = sum(order_items.quantity)` (itens com `status=true`).
4. Componentes mensais ativos (`MONTHLY_FIXED`/`MONTHLY_PERCENT`, `is_active`, `deleted_at IS NULL`) cujo período se intersecta (null = mês inteiro).
   - `MONTHLY_PERCENT`: `total = revenue × value/100`.
   - `MONTHLY_FIXED`: `total = value`.
   - `allocation_basis = PER_ORDER`: `perOrder = total / orderCount` (divisão igualitária).
   - `allocation_basis = PER_PRODUCT`: `perProduct = total / productCount`; pedido recebe `perProduct × qtdDeProdutos`.
   - Grava 1 linha por (order, component) em `order_monthly_allocations`. Idempotência: delete das linhas do (component, período) antes de inserir.
5. Atualiza `orders.monthly_cost_total = sum(allocations do pedido)`.
6. Resposta: resumo (por componente: total, nº pedidos, nº produtos, forma de rateio).

Divisão igualitária (PER_ORDER) não arredonda por pedido — o valor real `perOrder` pode ter centavos; `amount` é arredondado a 2 casas na gravação (centavos residuais ficam na última linha, como já ocorre no rateio do motor).

## Resumo financeiro (camadas)

Resposta do pedido (e venda externa) passa a expor:
- `total_cost` — custo da venda (congelado, como hoje).
- `monthly_cost_total` — rateio mensal (somado de `order_monthly_allocations`).
- `total_cost_with_monthly` = `total_cost + monthly_cost_total` (campo calculado na resposta, não persistido).
- `cost_breakdown` por item (individual, já existe) + `monthly_allocations` por pedido (individual, novo).

## Endpoints

| Método | Rota | Descrição |
|---|---|---|
| GET/POST/PUT/DELETE | `/api/product-subgroups(/:id)` | CRUD de subgrupos (ADMIN) |
| POST | `/api/cost-components/associate-subgroup` | associa componente→subgrupo |
| POST | `/api/cost-components/associate-batch` | vinculação em lotes (componente → vários produtos e/ou subgrupos) |
| GET/POST/PUT/DELETE | `/api/credit-fee-tiers(/:id)` | CRUD dos percentuais de crédito (ADMIN) |
| POST | `/api/cost-closing` | fechamento mensal (ADMIN) |
| — | `/api/external-sales` | adiciona campo `is_fair` |

## Suposições assumidas

- Taxa de crédito: base = `total_amount` (líquido pós-desconto); `payment_installments` null → 1x; aplica a Nuvemshop e Externos.
- Mensais: excluem cancelados; base = mês do `orders.created_at` (data real da venda).
- "Subgrupos por padrão" = usuário cria manualmente; sem auto-seed a partir de `products.category` nesta versão.
- `MONTHLY` antigo deixa de existir no enum; componente existente do tipo `MONTHLY` deve ser migrado/desativado (ver plano).

## Fora de escopo (nesta versão)

- Auto-seed de subgrupos a partir da categoria Nuvemshop.
- Agendamento automático (cron) do fechamento mensal — só endpoint manual.
- Tratamento de `product/deleted` (webhook) já pendente em outro doc.
