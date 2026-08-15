# Frontend — Prompt: Tela de Custos v2 (Motor de Custos completo)

Data: 2026-08-14 · Backend: branch `feat/cost-engine-v2` + `feat/cost-subgroup-linking` (implementado e testado, 138 testes verdes)

> Este prompt descreve **o que mudou no backend** e **as implementações/mudanças propostas na tela de Custos** do AuraSync Admin Portal. Antes de implementar, leia também `docs/FRONTEND_PROMPT_COST_ENGINE_V2.md` (resumo completo das capacidades do backend) e o `AGENTS.md` do frontend.

---

## 1. Contexto — o que o backend agora suporta

O motor de custos foi expandido e inclui:

- **Subgrupos de produto** — entidade nova que agrupa produtos (ex.: "Anéis", "Pulseiras"). Produto pertence a 1 subgrupo. Componentes de custo podem ser vinculados a produtos **e/ou** subgrupos, **em lote**.
- **Novos tipos de componente**: `PACKAGING` (embalagem com capacidade/consolidação), `MONTHLY_FIXED` (mensal fixo, rateado por pedido ou por produto) e `MONTHLY_PERCENT` (imposto % da receita). O antigo `MONTHLY` **não existe mais**.
- **Novas categorias**: `ACQUISITION` (custo de aquisição) e `CREDIT_FEE` (taxa de crédito).
- **Novos campos por componente**: `max_products_per_package`, `consolidates`, `allocation_basis` (`PER_ORDER` | `PER_PRODUCT`), `period_start`/`period_end` (período de incidência, ex.: tráfego pago) e `applies_to_fair_only` (só incide em vendas de Feira).
- **Taxa de crédito** configurável por parcelas (1x 5,19% + R$0,35 / 2x 6,38% / 3x 7,76%) — muda percentual, mas pedidos antigos ficam congelados.
- **Fechamento mensal** — endpoint que distribui os custos mensais entre os pedidos do mês.
- **Flag `is_fair`** na venda externa.
- **Resumo financeiro em camadas** no pedido: `total_cost` (venda) + `monthly_cost_total` (mensal rateado) = `total_cost_with_monthly`.

---

## 2. Diagnóstico — estado atual da tela de Custos (verificado no repo)

Arquivos atuais: `src/pages/Costs.tsx`, `src/components/costs/CostComponentFormDialog.tsx`, `src/components/costs/ProductAssociationsDialog.tsx`, `src/components/costs/SimulateCostDialog.tsx`, `src/services/api.ts` (costComponentsApi), `src/types/index.ts`, `src/lib/schemas.ts`, `src/lib/formatters.ts`.

| Peça | Estado atual | Problema |
|---|---|---|
| `types/index.ts` | `CostComponentType = 'FIXED'\|'PERCENT'\|'PER_ORDER'\|'MONTHLY'`; 7 categorias | **Desatualizado**: falta `PACKAGING`/`MONTHLY_FIXED`/`MONTHLY_PERCENT` no tipo; `MONTHLY` não existe mais; faltam categorias `ACQUISITION`/`CREDIT_FEE`; faltam os 5 campos novos; não há tipos de subgrupo/faixa de crédito/fechamento |
| `lib/schemas.ts` | `costComponentSchema` com tipos/campos antigos | **Desatualizado**: sem os novos tipos, sem validação condicional (PACKAGING exige capacidade; MONTHLY_FIXED exige base de rateio) |
| `CostComponentFormDialog.tsx` | Select de tipo com 4 opções; sem campos novos | **Desatualizado**: não dá para criar componente de embalagem/mensal, nem marcar consolidação/feira/período |
| `Costs.tsx` | Tabela + busca + CRUD + simular + associações por produto | **Parcial**: falta acesso a subgrupos, taxa de crédito, fechamento mensal e associação em lote |
| `ProductAssociationsDialog.tsx` | Associa componente ↔ **1 produto** | **Limitado**: não existe a visão por subgrupo nem lote |
| `services/api.ts` | `costComponentsApi` sem métodos de subgrupo/faixa/fechamento | **Faltam serviços**: `productSubgroupsApi`, `creditFeeTiersApi`, `costClosingApi`, associação por subgrupo/batch |
| `formatters.ts` | `typeLabel` já tem PACKAGING/MONTHLY_FIXED/MONTHLY_PERCENT; `categoryLabel` sem ACQUISITION/CREDIT_FEE | **Parcial**: falta `ACQUISITION`/`CREDIT_FEE` e label de `allocation_basis` |

---

## 3. Contratos de API (referência para o front)

Todas as mutações exigem `X-CSRF-TOKEN`; todos os endpoints de custo exigem `ADMIN`/`SUPER_ADMIN`.

### 3.1 Subgrupos
| Método | Rota | Corpo/query | Resposta |
|---|---|---|---|
| GET | `/api/product-subgroups` | `?is_active=&search=` | array de subgrupos |
| POST | `/api/product-subgroups` | `{ name, description?, is_active? }` | subgrupo |
| PUT | `/api/product-subgroups/:id` | campos opcionais | subgrupo |
| DELETE | `/api/product-subgroups/:id` | — | 204 (soft delete) |
| POST | `/api/product-subgroups/:id/products` | `{ product_ids: string[] }` | `{ assigned: number }` |
| GET | `/api/product-subgroups/:id/products` | `?page=&limit=&search=` | `{ products, total, page, limit }` |
| DELETE | `/api/product-subgroups/:id/products/:productId` | — | 204 |

### 3.2 Componentes (novos/mudados)
| Método | Rota | Corpo | Resposta |
|---|---|---|---|
| POST | `/api/cost-components/associate-subgroup` | `{ subgroup_id, cost_component_id, quantity? }` | associação |
| POST | `/api/cost-components/associate-subgroup-batch` | `{ subgroup_id, cost_component_ids: string[], quantity? }` | `201 { subgroup_id, associations }` (idempotente) |
| DELETE | `/api/cost-components/associate-subgroup-batch` | `{ subgroup_id, cost_component_ids }` | 204 |
| DELETE | `/api/cost-components/associate-subgroup/:id` | — | 204 |
| GET | `/api/cost-components/subgroup/:subgroupId` | — | `{ associations }` (com componente embutido) |
| POST | `/api/cost-components/associate-batch` | `{ cost_component_id, product_ids?, subgroup_ids?, quantity? }` | `201 { product[], subgroup[] }` |

Componente (create/update) agora aceita: `type` (6 valores), `category` (9 valores), `max_products_per_package`, `consolidates`, `allocation_basis`, `period_start`, `period_end`, `applies_to_fair_only`.

### 3.3 Taxa de crédito
| Método | Rota | Corpo | Resposta |
|---|---|---|---|
| GET | `/api/credit-fee-tiers` | — | `[{ id, installments, percent, fixed_fee, is_active }]` |
| PUT | `/api/credit-fee-tiers/:id` | `{ percent?, fixed_fee?, is_active? }` | faixa atualizada |

### 3.4 Fechamento mensal
| Método | Rota | Corpo | Resposta |
|---|---|---|---|
| POST | `/api/cost-closing` | `{ month: "YYYY-MM" }` ou `{ start_date, end_date }` | `{ period: { start, end }, components[], orders, products, allocations }` |

### 3.5 Venda externa e pedido
- `POST /api/external-sales` aceita `is_fair: boolean`.
- Pedido (detalhe/lista) expõe: `is_fair`, `monthly_cost_total`, `total_cost_with_monthly`, `monthly_allocations` (`[{ id, order_id, cost_component_id, amount, period_start, period_end }]`).

---

## 4. Implementações propostas (ordem sugerida)

### T1 — Atualizar tipos (`src/types/index.ts`)
- `CostComponentType`: `'FIXED' | 'PERCENT' | 'PER_ORDER' | 'PACKAGING' | 'MONTHLY_FIXED' | 'MONTHLY_PERCENT'`.
- `CostComponentCategory`: adicionar `'ACQUISITION' | 'CREDIT_FEE'`.
- `AllocationBasis`: `'PER_ORDER' | 'PER_PRODUCT'`.
- `CostComponent`: adicionar `max_products_per_package: number | null`, `consolidates: boolean`, `allocation_basis: AllocationBasis | null`, `period_start: string | null`, `period_end: string | null`, `applies_to_fair_only: boolean`.
- `CostComponentPayload`: mesmos campos (opcionais).
- Novos tipos: `ProductSubgroup`, `SubgroupAssociation`, `CreditFeeTier`, `CostClosingInput/Response`, `MonthlyAllocation`.
- `CostSimulateResponse`/`CostBreakdownItem`: `category` pode conter `ACQUISITION`/`CREDIT_FEE`.

### T2 — Atualizar schema (`src/lib/schemas.ts`)
- `costComponentSchema`: novos `type`/`category`/campos; `superRefine` cobrindo:
  - `PERCENT` → exige `calculation_base`
  - `MONTHLY_FIXED` → exige `allocation_basis`
  - `PACKAGING` → exige `max_products_per_package`
- `period_start`/`period_end` validados como `YYYY-MM-DD` (regex) quando informados.

### T3 — Atualizar `CostComponentFormDialog.tsx`
- Select de tipo com as 6 opções.
- Campos condicionais por tipo:
  - **PACKAGING**: `max_products_per_package` (int) + switch "Caixa consolidadora" (`consolidates`).
  - **MONTHLY_FIXED**: select `allocation_basis` (Por pedido / Por produto vendido).
  - **Qualquer tipo**: switch "Somente vendas de Feira" (`applies_to_fair_only`).
  - **Todos**: campos opcionais `period_start`/`period_end` (date inputs).
- Categoria: 9 opções (incluindo "Custo de aquisição" e "Taxa de crédito").
- Exibir valor com sufixo correto por tipo: `%` para `PERCENT`/`MONTHLY_PERCENT`, R$ para os demais.

### T4 — Atualizar formatters (`src/lib/formatters.ts`)
- `categoryLabels`: `ACQUISITION: 'Custo de aquisição'`, `CREDIT_FEE: 'Taxa de crédito'`.
- Novo `allocationBasisLabel`: `PER_ORDER: 'Por pedido'`, `PER_PRODUCT: 'Por produto vendido'`.

### T5 — Novos serviços (`src/services/api.ts`)
- `productSubgroupsApi`: CRUD + `assignProducts`, `listProducts`, `unassignProduct`.
- `costComponentsApi`: `associateSubgroup`, `associateSubgroupBatch`, `removeSubgroupAssociation`, `removeSubgroupAssociations` (batch), `getBySubgroup`, `associateBatch`.
- `creditFeeTiersApi`: `list`, `update`.
- `costClosingApi`: `close` (POST).
- `externalSalesApi.create`: adicionar `is_fair` ao payload.

### T6 — Página/Tab "Subgrupos" (nova)
Em `src/pages/Costs.tsx` (ou página própria) adicionar a área de subgrupos:
- Lista de subgrupos (nome, descrição, status) com busca.
- CRUD (criar/editar/desativar).
- **Atribuir produtos**: modal com busca de produtos + checkbox múltiplo → `POST /:id/products` (em lote). Exibir os produtos do subgrupo com `GET /:id/products` (paginado + busca) e botão para desvincular (`DELETE /:id/products/:productId`).
- **Vincular componentes**: modal "Componentes deste subgrupo" — lista as associações (`GET /api/cost-components/subgroup/:id`), permite **marcar vários componentes de uma vez** (`POST /associate-subgroup-batch`, com `quantity` único para todos) e **desmarcar em lote** (`DELETE /associate-subgroup-batch`).

### T7 — Ajustar `ProductAssociationsDialog.tsx`
- Manter a visão por produto, mas usar os mesmos componentes de UI de "vincular vários" quando fizer sentido (ex.: trocar o select único por um multi-select no `associate-batch`).
- Adicionar badge indicando o subgrupo do produto na listagem de produtos (se `product.subgroup_id` presente).

### T8 — Área "Taxa de crédito" (nova)
- Tabela 1x/2x/3x com `percent`, `fixed_fee`, `is_active`; edição inline ou modal (`PUT /api/credit-fee-tiers/:id`).
- Aviso permanente: "Alterações valem para novas vendas. Pedidos anteriores permanecem com os valores da época."

### T9 — Área "Fechamento mensal" (nova)
- Seletor de mês (`<input type="month">`) → `POST /api/cost-closing { month }`.
- Exibir o resumo da resposta: período, componentes alocados, nº pedidos, nº produtos, nº alocações.
- Estado de carregamento durante a execução e feedback de sucesso (idempotente — pode rodar de novo).

### T10 — Venda externa (`src/pages/Sales.tsx`)
- Adicionar switch "Venda de Feira" (`is_fair`) no formulário de venda.

### T11 — Pedido — resumo financeiro em camadas (drawer/listas)
- Exibir `total_cost` (custo da venda), `monthly_cost_total` (custos mensais rateados) e `total_cost_with_monthly` (total), com `monthly_allocations` expansível.

---

## 5. Regras obrigatórias de implementação (reforço)

1. **Nunca calcular custo/lucro/margem/embalagem no front** — exibir sempre os valores da API.
2. Formatar moeda com `Intl.NumberFormat('pt-BR', { style: 'currency' })`.
3. Valores `decimal` do backend podem vir como string em leituras cruas — `Number(...)` antes de exibir/formatar.
4. Toda mutação com `X-CSRF-TOKEN`; ações de custo ocultas para `EMPLOYEE` (`isAdmin`).
5. Estados de loading/erro/vazio em todas as listas e diálogos novos (padrão já usado em `Costs.tsx`).
6. Reutilizar componentes shadcn existentes e o padrão TanStack Query + mutations existentes (invalidate de queryKeys após sucesso).
7. Não duplicar URLs de endpoints — centralizar em `services/api.ts`.

---

## 6. Glossário (labels PT-BR)

| Valor | Label |
|---|---|
| `PACKAGING` | Embalagem |
| `MONTHLY_FIXED` | Mensal fixo |
| `MONTHLY_PERCENT` | Mensal (%) |
| `ACQUISITION` | Custo de aquisição |
| `CREDIT_FEE` | Taxa de crédito |
| `PER_ORDER` (allocation) | Por pedido |
| `PER_PRODUCT` (allocation) | Por produto vendido |
| `consolidates` | Caixa consolidadora (absorve as demais) |
| `max_products_per_package` | Máx. produtos por caixa |
| `applies_to_fair_only` | Somente vendas de Feira |
| `monthly_cost_total` | Custos mensais rateados |
| `total_cost_with_monthly` | Custo total (venda + mensal) |

---

## 7. Critérios de aceite

- Criar componente dos 6 tipos, com validação condicional e campos novos persistindo no backend.
- Criar subgrupo, atribuir produtos em lote, listar e desvincular produtos.
- Vincular/desvincular **N componentes a 1 subgrupo** em uma única ação (batch).
- Editar faixas de taxa de crédito e rodar fechamento mensal com feedback do resumo.
- Marcar venda externa como Feira.
- Pedido exibe as 3 camadas de custo.
- `tsc` sem erros, ESLint sem erros, fluxos completos contra o backend local.
