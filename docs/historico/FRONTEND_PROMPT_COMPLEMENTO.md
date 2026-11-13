# Frontend — Complemento ao Prompt (alinhamento com o backend atual)

Data: 2026-08-01 · Referente ao prompt "Frontend AuraSync — Visão Geral" e ao backend P0 (Motor de Custos, Venda Externa, Clientes, Pedidos enriquecidos, Dashboard corrigido).

Este documento NÃO substitui o prompt original — mantém o mesmo sentido e complementa com a realidade do backend implementado: endpoints disponíveis, campos reais, regras técnicas (CSRF/roles/paginação) e gaps que impactam a interface.

---

## 1. Erratas / ajustes ao prompt original

### Módulo de Custos

| Prompt | Ajuste |
|---|---|
| Campos do cadastro: Nome, Descrição, Tipo, Valor, Status | O backend exige também **Categoria** (Embalagem, Imposto, Taxa, Frete, Operacional, Marketing, Outros) e **Base de cálculo** (Preço ou Custo — somente para o tipo Percentual) |
| Tipos: Embalagem, Imposto, Frete, Comissão, Cartão, Operacional | São **4 tipos de cálculo**: Valor fixo (`FIXED`), Percentual (`PERCENT`), Por pedido (`PER_ORDER`), Mensal (`MONTHLY`). "Mensal" (contadora, pró-labore, gestora de tráfego) é **somente controle** — não participa do cálculo por venda |
| Tela principal: "Quantidade de produtos utilizando o componente" | **Gap do backend**: não existe endpoint de agregação (componente → nº de produtos). Necessário criar `GET /api/cost-components?with_product_count` ou similar, ou exibir a coluna vazia/oculta até lá |
| Sem cálculo no front | Existe `POST /api/cost-components/simulate` (variante + preço + quantidade → snapshot completo sem persistir). Usar para "Simular custo" na associação |

Endpoints reais: `GET|POST /api/cost-components`, `PUT|DELETE /api/cost-components/:id`, `POST /api/cost-components/associate` (`{ product_id, cost_component_id, quantity }`), `DELETE /api/cost-components/associate/:id`, `GET /api/cost-components/product/:productId`, `POST /api/cost-components/simulate`. Associação é por **produto** (vale para todas as variantes). Todos exigem ADMIN/SUPER_ADMIN + CSRF.

### Venda Externa ("Realizar Venda")

- `POST /api/external-sales` recebe **nome + email** do cliente — **não existe `customer_id`** no payload. "Selecionar cliente" = busca (`GET /api/external-sales/customers?search=`) que **preenche** os campos nome/email.
- Cliente **sem email**: o backend **não cria** registro de cliente (chave é o email). O front pode avisar "Cliente sem email não será salvo no cadastro".
- Campos aceitos: `customer_name` (obrigatório), `customer_email`, `items[]` (`variant_id`, `quantity`, `unit_price`), `discount_amount`, `payment_method`, `gateway`, `payment_installments`, `shipping_cost_owner`, `shipping_cost_customer`, `status` (default `PAID`).
- `payment_method`/`gateway` são **texto livre** no backend → o front exibe opções em PT-BR (ex.: "Cartão de crédito", "Pix", "Boleto") e envia o valor escolhido.
- Buscas: `GET /api/external-sales/products?search=` e `GET /api/external-sales/customers?search=` — ambos exigem **ADMIN/SUPER_ADMIN**.
- A resposta já vem com `total_amount` líquido (pós-desconto), `total_cost`, `total_profit`, `margin_percent` e o snapshot por item — **sem cálculo no front**.

### Pedidos / Drawer

O backend envia tudo pronto. O drawer deve exibir, direto da API:

- **Cliente**: `customer_name`, `customer_email`, `shipping_city`, `shipping_province`
- **Status**: `status_label` (PT-BR), `commercial_status` ("Venda concretizada"/"Em aberto"/"Cancelado"/"Enviado"), `payment_status_label`, `fulfillment_status_label`
- **Origem**: `source` → "Nuvemshop" | "Venda externa"
- **Itens**: por item — `unit_price`, `quantity`, `unit_total_cost`, `unit_profit`, `margin_percent`, e `cost_breakdown` (detalhe congelado: componente, tipo, valor, quantidade — exibir como tabela/lista expansível)
- **Pagamento**: `payment_method`, `gateway`, `payment_installments`
- **Frete**: `shipping_cost_customer`, `shipping_cost_owner`, `shipping_carrier`, `has_free_shipping`
- **Endereço**: `shipping_city`, `shipping_province`
- **UTMs**: `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`
- **Financeiro**: `total_amount`, `discount_amount`, `total_cost`, `total_profit`, `margin_percent`
- **Timeline**: `created_at`, `paid_at`, `shipped_at`, `completed_at`, `cancelled_at` (apenas as preenchidas)

`cost_breakdown` é um array de `{ component_id, name, type, category, unit_value, quantity, line_total }` — valores já calculados pelo Motor de Custos.

### Dashboard

- **Cancelados**: já excluídos no backend (todas as métricas). O front apenas consome.
- **Filtro de data**: enviar `start_date` e `end_date` (ISO) para `GET /api/dashboard/marketing` e `GET /api/dashboard/orders` (além de `days`). **Gap**: `GET /api/dashboard/stock` **não aceita datas** — os cards de estoque não respondem ao intervalo selecionado (pendência no backend).
- **Traduções**: preferir os labels da API (`status_label`, `commercial_status`, etc.). Mapear localmente apenas o que ainda vem cru: `storefront` (ex.: `mobile`, `web`, `other_devices`), `payment_method`, `gateway`, `utm_*`, `shipping_province`.
- Endpoints: `GET /api/dashboard/stock`, `GET /api/dashboard/marketing?days=30&start_date=&end_date=`, `GET /api/dashboard/orders?days=30&start_date=&end_date=` — todos exigem ADMIN/SUPER_ADMIN.

### Clientes

- Campos do prompt batem com a API: `name`, `email`, `city`, `province`, `order_count`, `total_spent`, `average_ticket`, `first_purchase_at`, `last_purchase_at`.
- O detalhe (`GET /api/customers/:id`) já traz `indicators`: forma de pagamento favorita, gateway preferido, recorrência (binária) — os "espaços para métricas futuras" já existem.
- Histórico: `GET /api/customers/:id/orders`.
- Paginação: `GET /api/customers?page=&limit=&search=`. Todos exigem ADMIN/SUPER_ADMIN.
- Sem email: cliente não existe no cadastro (não criar entrada no front).

### Produtos

- A busca do backend (`GET /api/products?search=`) já cobre **produto + variantes** (nome, slug, `nuvemshop_id`, SKU, nome da variante, `nuvemshop_variant_id`) — a "busca global" do prompt é suportada.
- Listagem pública (sem auth) para GETs de produto; mutações exigem ADMIN + CSRF.

### Traduções

- Regra geral atualizada: **usar os labels enviados pela API; tratar localmente apenas o que ainda vier cru** (storefront, payment_method, gateway, UTMs, província).
- Glossário sugerido no item 4 abaixo.

---

## 2. Requisitos técnicos que o prompt não cobre

1. **Autenticação por cookie + CSRF**: sessão via cookie HttpOnly (`aurasync_token`). Toda mutação (POST/PUT/DELETE) deve enviar o header `X-CSRF-TOKEN`, obtido em `GET /api/auth/csrf` (define o cookie `XSRF-TOKEN`). Sem isso, mutações devolvem 403.
2. **Roles**: endpoints de Custos, Clientes, Pedidos (leitura), Venda Externa, Dashboard e sincronização exigem `ADMIN`/`SUPER_ADMIN`. O usuário `EMPLOYEE` recebe 403 — **esconder/desabilitar ações indisponíveis** no menu e nos botões (o `/api/auth/me` informa a role).
3. **Paginação**: todas as listas usam `page` e `limit` (`/orders`, `/products`, `/customers`, `/inventory`).
4. **Valores monetários**: o backend devolve números nos endpoints enriquecidos; ainda assim, **nunca calcular lucro/margem/custo no front** — exibir os valores recebidos (com `Intl.NumberFormat('pt-BR', { style: 'currency' })` para formatação).
5. **Performance**: os endpoints já são agregados/enriquecidos — evitar N+1 (não buscar pedido por pedido quando a lista já traz itens + financeiro; não recalcular indicadores).
6. **WebSocket**: o backend emite eventos `orders_updated`/`products_updated` — usar para atualizar listas sem recarregar.

---

## 3. Gaps do backend que impactam o front (pendências)

| Gap | Impacto no front | Status |
|---|---|---|
| Sem endpoint "componentes com contagem de produtos" | Coluna "Qtd. de produtos" da tela de custos sem dado | Pendente (criar agregação ou ocultar coluna) |
| `/api/dashboard/stock` sem `start_date`/`end_date` | Cards de estoque não respondem ao filtro de data global | Pendente |
| `storefront`, `payment_method`, `gateway`, UTMs retornam crus | Exige mapa de tradução no front (glossário abaixo) | Contornado no front |
| `end_date` com data pura (`2026-08-01`) exclui o resto do dia | Gráficos podem "perder" o último dia ao selecionar range | Pendente (backend) — envio de `end_date` com hora `T23:59:59` contorna |

---

## 4. Glossário PT-BR recomendado (mapa de tradução do front)

### Storefront (origem do pedido)
| Valor da API | Exibição |
|---|---|
| `mobile` | Celular |
| `web` | Site |
| `other_devices` | Outros dispositivos |
| `EXTERNAL` (source) | Venda externa |
| `NUVEMSHOP` (source) | Nuvemshop |

### Formas de pagamento (`payment_method` — texto livre; sugerir opções na criação)
| Valor | Exibição |
|---|---|
| `credit_card` | Cartão de crédito |
| `debit_card` | Cartão de débito |
| `pix` | Pix |
| `bank_transfer` | Transferência bancária |
| `boleto` | Boleto |
| `cash` | Dinheiro |

### Status (preferir labels da API; fallback local)
| Valor cru | Exibição |
|---|---|
| `PENDING` / `pending` / `open` | Pendente / Em aberto |
| `PAID` / `paid` | Pago |
| `SHIPPED` / `shipped` | Enviado |
| `DELIVERED` / `delivered` / `closed` | Entregue / Concluído |
| `CANCELED` / `cancelled` | Cancelado |
| `refunded` | Reembolsado |
| `voided` | Estornado |

### Tipos de componente de custo (`type`)
| Valor | Exibição |
|---|---|
| `FIXED` | Valor fixo |
| `PERCENT` | Percentual |
| `PER_ORDER` | Por pedido |
| `MONTHLY` | Mensal (controle) |

### Categorias de componente (`category`)
| Valor | Exibição |
|---|---|
| `PACKAGING` | Embalagem |
| `TAX` | Imposto |
| `FEE` | Taxa |
| `SHIPPING` | Frete |
| `OPERATIONAL` | Operacional |
| `MARKETING` | Marketing |
| `OTHER` | Outros |

### Base de cálculo (`calculation_base`)
| Valor | Exibição |
|---|---|
| `PRICE` | Preço de venda |
| `COST` | Custo do produto |

---

## 5. Checklist de consistência (validação final da interface)

- [ ] Nenhum texto em inglês visível (login → todas as páginas → drawer → empty states → erros/sucesso)
- [ ] Dashboard: todos os cards/gráficos/rankings/tabelas respondem ao mesmo intervalo de data
- [ ] Nenhum pedido cancelado aparece como venda em qualquer indicador
- [ ] Drawer de pedido: seções Cliente, Itens, Pagamento, Frete, Endereço, UTMs, Financeiro, Origem, Status, Timeline
- [ ] "Realizar Venda" envia apenas dados; resposta exibe custo/lucro/margem vindos da API
- [ ] Custo/lucro/margem exibidos vêm da API (nunca calculados no front)
- [ ] Mutações funcionam com CSRF; ações indisponíveis ocultas por role
- [ ] Componentes reutilizáveis padronizados (botões, inputs, selects, datepickers, cards, badges, modais, drawers, tabelas, filtros, paginação)
- [ ] Responsivo: desktop, notebook, tablet (tabelas com scroll horizontal só quando necessário)
