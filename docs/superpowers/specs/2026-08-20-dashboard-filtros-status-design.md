# Dashboard: Filtros de Data, Campanha N/A e fulfillment_status — Design

**Data:** 2026-08-20

## Contexto

O dashboard e a página de Pedidos apresentam 4 problemas relatados pelo usuário:

1. **Filtro de data estranho** — clicar num único dia no calendário "não seleciona nada" (o `Calendar` é controlado e reverte o 1º clique), não há como voltar ao padrão de 30 dias, e o backend ignora silenciosamente quando só um de `start_date`/`end_date` é enviado.
2. **Campanha "N/A" no by_campaign** — há um grupo com `campaign: null` (27 pedidos / R$ 4.030,09 nos últimos 30 dias). Não existe `campaign_id` nem tabela de campanhas; só colunas `utm_*`. O `utm_campaign` do Nuvemshop vem como ID numérico (ex: `120222198954390582`). O grupo `null` são pedidos sem `utm_campaign`, sendo ~15 sem nenhum UTM, ~11 de `ig/social` e 1 de `IGShopping`.
3. **Receita do dashboard errada** — o filtro só excluía `status = 'CANCELED'`. Pedidos com `payment_status = 'voided'` ("Estornado") e `fulfillment_status` normal ("Enviado"/"Entregue") contavam como receita (últimos 30 dias: 3 pedidos / R$ 625,15).
4. **Filtro de status da página de Pedidos** — usa a coluna `status` (legado), mas a fonte considerada é `fulfillment_status` (já usada no `by_status` do dashboard).

## Decisões (validadas com o usuário)

| Tema | Decisão |
|---|---|
| Filtro de data | **Range + dia único**: 1º clique seleciona um único dia (from=to), 2º clique em outro dia forma o intervalo; presets mantidos; botão "Limpar" volta ao padrão (últimos 30 dias). |
| Campanha N/A | **Agrupar por source/medium** quando `utm_campaign` é null. Grupo sem nenhum UTM vira "Orgânico/Direto" (rótulo no frontend). |
| Exclusão de receita | **Sinais negativos apenas**: excluir se `deleted_at` setado OU `status` em {CANCELED, cancelled} OU `payment_status` em {voided, refunded, cancelled} OU `fulfillment_status` em {cancelled, CANCELED}. `payment_status = 'pending'` continua contando. |
| Escopo status→fulfillment | **Pedidos + Dashboard**: filtro da página de Pedidos (GET /orders) passa a usar `fulfillment_status`; `by_status` do dashboard já usa. Campos `status` antigos continuam existindo no detalhe. |

## Estado atual (verificado em 2026-08-20)

### Distribuição real dos dados (prod)

- `status`: CANCELED (201) e PENDING/DELIVERED (1838) — `status` NÃO reflete entrega.
- `payment_status`: paid (1649, R$ 232.495), voided (78, R$ 9.904), pending (112, R$ 13.380).
- `fulfillment_status`: DELIVERED (1327), UNPACKED (201), MARKED_AS_FULFILLED (138), DISPATCHED (113), PACKED (2), null (63).
- Pedidos voided NÃO cancelados: 3 PENDING + 1 DELIVERED (R$ 625,15 nos últimos 30 dias → devem sair da receita).
- `utm_campaign` null: 751 pedidos (606 sem nenhum UTM, 93 `ig/social`, 40 `IGShopping/Social`, 9 `ig/social`, 1 `chatgpt.com`, 1 `nuvem-app`).

### Código relevante

- `dashboard.repository.ts:10-12` — `validOrderFilter` só exclui `status <> 'CANCELED'` + `deleted_at`.
- `dashboard.repository.ts:14-25` — `dateWindow`: exige AMBOS start_date/end_date; senão cai no sliding window de `days`. Sem validação de formato/ordem.
- `dashboard.repository.ts:177-186` — `byCampaign` agrupa só por `utm_campaign`.
- `order.router.ts:32` — GET /orders filtra por `status`.
- `order.repository.ts:545-547` — `findAll` filtra `where('status', filters.status)`.
- Frontend: `DateRangePicker.tsx:62-66` comita só quando `from` E `to` existem (1º clique invisível); `MarketingSection.tsx:110` renderiza `camp.campaign || 'N/A'`; `Orders.tsx:160-175` filtro por `status` com valores maiúsculos legados.

## Arquitetura da solução

### Backend

1. **Filtro de receita (`validOrderFilter`)** — vira o único ponto de verdade:
   ```ts
   const NEGATIVE_STATUS = ["CANCELED", "cancelled"];
   const NEGATIVE_PAYMENT = ["voided", "refunded", "cancelled"];
   const NEGATIVE_FULFILLMENT = ["cancelled", "CANCELED"];
   ```
   - `whereNull('orders.deleted_at')`
   - `whereNotIn('orders.status', NEGATIVE_STATUS)` (status é NOT NULL)
   - `payment_status`/`fulfillment_status` são nullable → `whereNull(...) OR whereNotIn(...)` para não descartar NULLs.
   - Aplicar no `baseQuery` (marketing + orders), `topProducts`, `repeatRow` e nas subqueries de estoque (no-sales/turnover/dead-stock).

2. **`by_campaign`** — subquery com CASE:
   - `campaign` = `utm_campaign` (null quando não há).
   - `source`/`medium` = `utm_source`/`utm_medium` SOMENTE quando `utm_campaign` é null (senão null).
   - `GROUP BY campaign, source, medium` via subquery (Postgres exige colunas no GROUP BY).
   - Schema `CampaignStats` ganha `source` e `medium` (nullable).

3. **`dateWindow`** — aceita só um dos dois parâmetros (vira dia único, ex: só `start_date` = aquele dia inteiro); lança erro se `end < start`. Router valida formato `YYYY-MM-DD` com regex no Zod.

4. **GET /orders** — query param `fulfillment_status` substitui `status` no filtro. Filtro case-insensitive com null tratado como `pending`:
   `COALESCE(LOWER(orders.fulfillment_status), 'pending') = <param>`.

### Frontend (`aurasync-admin-portal`)

1. **`DateRangePicker`** — estado `pendingStart`:
   - 1º clique → comita `{from, to}` = dia único (e highlight via selected controlado).
   - 2º clique em dia diferente → estende para intervalo `{min, max}` e fecha o popover.
   - 2º clique no mesmo dia → confirma dia único e fecha.
   - Botão "Limpar" → `{from: null, to: null}` (volta ao padrão 30 dias).
   - Label mostra dia único como `dd/MM/yyyy` e range como `dd/MM/yyyy — dd/MM/yyyy`.
   - Teste com @testing-library/react.

2. **`MarketingSection`** — coluna Campanha renderiza:
   - `camp.campaign` quando presente (ID do Nuvemshop).
   - `utmSourceLabel(source) / utmMediumLabel(medium)` quando `campaign` é null e há source/medium.
   - "Orgânico/Direto" quando tudo null.
   - Types: `CampaignStats` ganha `source`/`medium`.

3. **`Orders.tsx`** — filtro vira `fulfillment_status` com opções: Pendente (null+pending), Empacotando, Despachado, Entregue, Marcado como Concluído, Cancelado. `api.ts` `ordersApi.getAll` aceita `fulfillment_status`.

## Fora de escopo

- Mapear IDs de campanha → nomes reais (exige API Nuvemshop + tabela nova).
- Mudar `PUT /orders/:id` (campo `status` continua existindo para ações manuais).
- `cost-closing.repository.ts` e `customer.repository.ts` (continuam com `status <> 'CANCELED'`).
- Multi-seleção de dias soltos (não consecutivos).

## Testes

- Backend (TDD, integration, `npm test`):
  - Pedido `payment_status=voided` não aparece em receita/AOV/top_products/by_status.
  - Pedido `fulfillment_status=cancelled` não aparece.
  - `by_campaign` agrupa null-campaign por source/medium; sem-UTM vira grupo de nulls.
  - Só `start_date` = janela de um único dia (não cai no sliding window).
  - GET /orders filtra por `fulfillment_status` (pending casa null + 'pending').
- Frontend: `DateRangePicker.test.tsx` (dia único, range, limpar); `MarketingSection` usa tipos novos; lint + build.

## Impacto em dados reais

- Receita dos últimos 30 dias: R$ 13.413,19 → R$ 13.330,59 (exclui 3 pedidos voided, R$ 625,15).
- by_campaign: o grupo único `null` (27 pedidos) vira grupos `ig / social`, `IGShopping / Social`, `sem UTM` ("Orgânico/Direto").
