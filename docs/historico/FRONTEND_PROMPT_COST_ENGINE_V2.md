# Frontend — Motor de Custos v2 (resumo completo para a interface)

Data: 2026-08-14 · Branch: `feat/cost-engine-v2`

Documento de alinhamento entre o backend (Motor de Custos v2, já implementado e testado — 127 testes verdes) e a interface. Complementa o `FRONTEND_PROMPT_COMPLEMENTO.md` com tudo que mudou/foi adicionado: novos endpoints, novos campos, comportamentos do motor e regras de exibição.

**Regra de ouro (repetida):** o front **nunca calcula** custo/lucro/margem/embalagem — exibe sempre os valores que a API entrega.

---

## 1. Visão geral do que mudou

| Antes | Agora |
|---|---|
| Componentes só por **produto** (`product_cost_components`) | Componentes por **produto E subgrupo** (`subgroup_cost_components`) + vinculação **em lotes** |
| Tipos: FIXED / PERCENT / PER_ORDER / MONTHLY (controle, sem cálculo) | Tipos: FIXED / PERCENT / PER_ORDER / **PACKAGING** / **MONTHLY_FIXED** / **MONTHLY_PERCENT** |
| Categorias: 7 (sem aquisição) | + **ACQUISITION** e **CREDIT_FEE** (9 categorias) |
| Sem subgrupos | **`product_subgroups`** — produto pertence a 1 subgrupo (`products.subgroup_id`) |
| Taxa de crédito inexistente | **`credit_fee_tiers`** (1x/2x/3x) configurável, aplicada e congelada na venda |
| Custos mensais fora do cálculo | **Fechamento mensal** (`/api/cost-closing`) distribui mensais por pedido/produto e imposto % |
| Pedido sem `is_fair` / custo mensal | Pedido expõe `is_fair`, `monthly_cost_total`, `total_cost_with_monthly`, `monthly_allocations` |
| Venda externa sem flag | Venda externa aceita `is_fair` (Feira) |

---

## 2. Subgrupos de produto

Novo módulo — agrupa produtos para regras de embalagem e custos compartilhados.

### Endpoints (todos ADMIN/SUPER_ADMIN + CSRF em mutações)

| Método | Rota | Corpo / query | Retorna |
|---|---|---|---|
| GET | `/api/product-subgroups` | `?is_active=&search=` | lista de subgrupos |
| POST | `/api/product-subgroups` | `{ name, description?, is_active? }` | subgrupo criado |
| PUT | `/api/product-subgroups/:id` | `{ name?, description?, is_active? }` | subgrupo atualizado |
| DELETE | `/api/product-subgroups/:id` | — | 204 (soft delete) |
| POST | `/api/product-subgroups/:id/products` | `{ product_ids: uuid[] }` | `{ assigned: number }` — atribui produtos ao subgrupo **em lote** |

### Efeito no produto

- `products.subgroup_id` (uuid nullable) aparece na resposta dos produtos (leitura via `select *`).
- Um produto pertence a **um** subgrupo. Atribuir novamente move o produto.

---

## 3. Catálogo de componentes de custo (estendido)

### Endpoints novos (além dos existentes de componente)

| Método | Rota | Corpo |
|---|---|---|
| POST | `/api/cost-components/associate-subgroup` | `{ subgroup_id, cost_component_id, quantity? }` (default 1) |
| POST | `/api/cost-components/associate-batch` | `{ cost_component_id, product_ids?: uuid[], subgroup_ids?: uuid[], quantity? }` — exige pelo menos um dos arrays (vinculação em lotes) |
| DELETE | `/api/cost-components/associate-subgroup/:id` | — |
| GET | `/api/cost-components/subgroup/:subgroupId` | — retorna `{ associations: [...] }` com o componente embutido |

### Tipos (`type`)

| Valor | Significado | Participa na venda? |
|---|---|---|
| `FIXED` | Valor fixo por unidade (`value × quantity` da associação) | Sim, na hora da venda |
| `PERCENT` | Percentual sobre base `PRICE` (preço) ou `COST` (custo) | Sim, na hora da venda |
| `PER_ORDER` | Valor único por pedido, rateado entre os itens | Sim, na hora da venda |
| `PACKAGING` | Custo de **uma caixa**; usa `max_products_per_package` e `consolidates` | Sim, na hora da venda (regra de caixas) |
| `MONTHLY_FIXED` | Valor mensal fixo, rateado no fechamento do mês | Não — só no fechamento |
| `MONTHLY_PERCENT` | % sobre a receita do mês (imposto) | Não — só no fechamento |

### Categorias (`category`) → coluna do resumo por item

| Categoria | Aparece em |
|---|---|
| `ACQUISITION` | `unit_cost` (custo de aquisição do produto) |
| `PACKAGING` | `unit_packaging_cost` |
| `TAX` | `unit_tax` |
| `FEE` | `unit_platform_fee` |
| `SHIPPING` | `unit_shipping_cost` |
| `OPERATIONAL` | `unit_operational_cost` |
| `MARKETING` | `unit_marketing_cost` |
| `OTHER` | `unit_other_cost` |
| `CREDIT_FEE` | `unit_platform_fee` (taxa de crédito, built-in) |

### Campos novos no componente

| Campo | Tipo | Obrigatório quando |
|---|---|---|
| `max_products_per_package` | int positivo | `type = PACKAGING` |
| `consolidates` | boolean (default false) | — |
| `allocation_basis` | `PER_ORDER` \| `PER_PRODUCT` | `type = MONTHLY_FIXED` |
| `period_start` / `period_end` | `YYYY-MM-DD` (null = mês inteiro) | — (tráfego pago com período) |
| `applies_to_fair_only` | boolean (default false) | — (só incide se pedido `is_fair=true`) |

Regras de validação no cadastro (o backend devolve 400):
- `PERCENT` exige `calculation_base`.
- `MONTHLY_FIXED` exige `allocation_basis`.
- `PACKAGING` exige `max_products_per_package`.

---

## 4. Taxa de crédito (`credit_fee_tiers`)

Regra embutida por nº de parcelas — **configurável** mas **congelada no snapshot** da venda: alterar o percentual depois **não afeta** pedidos anteriores.

### Endpoints

| Método | Rota | Corpo |
|---|---|---|
| GET | `/api/credit-fee-tiers` | — retorna as faixas ativas ordenadas por parcelas |
| PUT | `/api/credit-fee-tiers/:id` | `{ percent?, fixed_fee?, is_active? }` |

### Seed padrão

| Parcelas | Percentual | Fixa |
|---|---|---|
| 1x (à vista) | 5.19% | R$ 0,35 |
| 2x | 6.38% | R$ 0,00 |
| 3x | 7.76% | R$ 0,00 |

Cálculo aplicado na venda: `taxa = total_amount × percent/100 + fixed_fee`, base = valor líquido do pedido (pós-desconto). `payment_installments` nulo é tratado como 1x.

---

## 5. Fechamento mensal (`/api/cost-closing`)

Job manual (endpoint único) que distribui os custos mensais entre os pedidos do mês. **Idempotente** — re-rodar recalcula e sobrescreve sem duplicar.

| Método | Rota | Corpo |
|---|---|---|
| POST | `/api/cost-closing` | `{ month: "YYYY-MM" }` **ou** `{ start_date, end_date }` (ISO) |

### Resposta

```jsonc
{
  "period": { "start": "2026-08-01", "end": "2026-09-01" },
  "components": [
    { "id": "uuid", "name": "Equipe", "type": "MONTHLY_FIXED", "allocation_basis": "PER_ORDER" }
  ],
  "orders": 4,
  "products": 6,
  "allocations": 4
}
```

### Regras do rateio

- Pedidos elegíveis: não cancelados, data = `created_at` do pedido dentro do período.
- `MONTHLY_FIXED` + `PER_ORDER` → valor dividido igualmente por pedido.
- `MONTHLY_FIXED` + `PER_PRODUCT` → valor ÷ nº de produtos vendidos; cada pedido paga `perProduto × seus produtos`.
- `MONTHLY_PERCENT` → % sobre a receita total do período, depois rateado por pedido/produto conforme `allocation_basis`.
- Componentes com `period_start/end` só entram se o período do fechamento intersectar o deles.

---

## 6. Resumo financeiro do pedido (camadas)

A resposta do pedido (detalhe e lista) e da venda externa agora trazem **duas camadas de custo**:

| Campo | Significado |
|---|---|
| `total_cost` | Custo **da venda** (congelado no momento da venda: aquisição, embalagem, taxas, feira, frete) |
| `monthly_cost_total` | Custo **mensal rateado** (do fechamento do mês) |
| `total_cost_with_monthly` | **Soma** das duas camadas (exibir como "Custo total") |
| `monthly_allocations` | Detalhe individual do rateio mensal: `[{ id, order_id, cost_component_id, amount, period_start, period_end }]` |
| `is_fair` | boolean — pedido de Feira |

No drawer do pedido, a seção Financeiro deve mostrar (sugestão):
- Total da venda (bruto) / desconto / total líquido
- **Custo da venda** (`total_cost`) — expansível para `cost_breakdown` por item (já existia)
- **Custos mensais rateados** (`monthly_cost_total`) — expansível para `monthly_allocations` (componente + valor)
- **Custo total** = `total_cost_with_monthly`
- Lucro da venda (`total_profit`) e margem (`margin_percent`) — **da API**, como sempre

---

## 7. Venda externa — flag Feira

`POST /api/external-sales` aceita agora:

```jsonc
{
  "customer_name": "...",
  "items": [{ "variant_id": "...", "quantity": 1, "unit_price": 100 }],
  "is_fair": true,          // novo — marca a venda como Feira
  "payment_installments": 2, // já existia — aciona a taxa de crédito
  // demais campos como antes
}
```

- `is_fair=true` ativa componentes com `applies_to_fair_only` (ex.: "Custo feira").
- `payment_installments` aciona a taxa de crédito da faixa correspondente (1x/2x/3x) — ambos já congelados no snapshot.

---

## 8. Comportamento do motor na venda (o que o front pode explicar ao usuário)

1. **Aquisição**: componente `ACQUISITION` (por produto ou subgrupo) vira o `unit_cost`. Sem componente, usa `variant.cost_price` (fallback legado).
2. **Embalagem (PACKAGING)**:
   - Caixas por subgrupo = `ceil(produtos do subgrupo / max_products_per_package)`.
   - Se houver um componente com `consolidates=true` cujo subgrupo tem produto no pedido, **tudo** vai na caixa do consolidador: `ceil(total de produtos do pedido / capacidade do consolidador)` e as outras embalagens zeram.
   - Exemplo do negócio: Subgrupo A (anéis, caixa p/ 6) + Subgrupo B (pulseiras, caixa maior, consolidadora). Pedido com 5 anéis + 1 pulseira → **1 caixa B**; embalagem A não é contada.
3. **Taxa de crédito**: por `payment_installments` (vista 5,19% + R$0,35 / 2x 6,38% / 3x 7,76%).
4. **Feira**: componentes `applies_to_fair_only` só quando `is_fair=true`.
5. **Frete**: vem do JSON do pedido (`shipping_cost_owner`), rateado como antes.
6. **Mensais**: nunca entram na venda — aparecem só após o `POST /api/cost-closing` no campo `monthly_cost_total`.

---

## 9. Requisitos técnicos para consumir (igual ao complemento anterior)

1. **Auth**: cookie HttpOnly `aurasync_token` + header `X-CSRF-TOKEN` (de `GET /api/auth/csrf`) em toda mutação.
2. **Roles**: todos os endpoints novos exigem `ADMIN`/`SUPER_ADMIN` (esconder ações de `EMPLOYEE`).
3. **Valores monetários**: sempre exibir o que a API devolve (`Intl.NumberFormat('pt-BR', { style: 'currency' })`); nunca recalcular.
4. **Decimais**: colunas `decimal` podem vir como string em leituras cruas — converter com `Number(...)` apenas para exibição.
5. **WebSocket**: eventos `orders_updated`/`products_updated` continuam existindo.

---

## 10. Glossário PT-BR (novos valores)

### Tipos de componente
| Valor | Exibição |
|---|---|
| `FIXED` | Valor fixo |
| `PERCENT` | Percentual |
| `PER_ORDER` | Por pedido |
| `PACKAGING` | Embalagem |
| `MONTHLY_FIXED` | Mensal fixo |
| `MONTHLY_PERCENT` | Mensal (%) |

### Categorias novas
| Valor | Exibição |
|---|---|
| `ACQUISITION` | Custo de aquisição |
| `CREDIT_FEE` | Taxa de crédito |

### Rateio mensal
| Valor | Exibição |
|---|---|
| `PER_ORDER` | Por pedido |
| `PER_PRODUCT` | Por produto vendido |

---

## 11. Sugestões de telas (apenas orientação)

- **Custos**: grid de componentes com os novos campos condicionais por tipo (capacidade/consolidação para Embalagem; base de rateio para Mensal fixo; período para tráfego; flag Feira). Vincular em lote: selecionar vários produtos e/ou subgrupos num modal.
- **Subgrupos**: CRUD simples + busca de produtos para atribuir em lote.
- **Taxa de crédito**: tabela 1x/2x/3x editável, com aviso "mudanças valem para novas vendas (pedidos anteriores ficam congelados)".
- **Fechamento mensal**: tela com seletor de mês + botão "Fechar mês", exibindo o resumo da resposta (componentes, nº pedidos, nº produtos, alocações).
- **Pedido**: Financeiro em camadas (venda + mensal + total) conforme seção 6.
