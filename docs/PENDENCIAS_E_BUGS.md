# AuraSync — Pendências e Bugs (sessão Cost Engine + P0)

Data: 2026-08-01 · Branch: `feat/cost-engine-and-modules` (merged em `develop`)

Documento de acompanhamento para Obsidian. Lista o que ficou pendente, os bugs encontrados/contornados durante a implementação do Motor de Custos, Venda Externa, Clientes, enriquecimento de Pedidos e correções de Dashboard.

---

## 1. Pendências (menores — de adiar, não bloqueiam)

### 1.1 Rateio com arredondamento (Motor de Custos)
- `src/lib/cost-engine.ts` — o rateio por unidade usa `round2(share × valor)` por item. Em divisões não exatas (ex.: frete 10 com 3 itens iguais → 3,33×3 = 9,99) o `total_cost` diverge por centavos do custo real.
- **Fix sugerido:** alocar o resto (centavos) ao último item do pedido para fechar a conta.

### 1.2 Limite de fim de dia no `end_date` (Dashboard)
- `src/repositories/dashboard.repository.ts` (`dateWindow`) usa `created_at <= end`. Um `end_date` puro (ex.: `2026-08-01`) vira `00:00:00`, excluindo o resto do dia.
- **Fix sugerido:** usar `created_at < end + 1 dia` (ou parser `+T23:59:59.999`).

### 1.3 `product_id` nunca usado no motor
- `src/lib/cost-engine.ts` — o campo `product_id` existe no input do motor, mas o cálculo não o lê. Fica como future-proofing.
- **Fix sugerido:** remover, ou usar futuramente para agregações por produto.

### 1.4 Sem testes de router para os módulos novos
- Não há testes de auth/role (router) para: `cost.router`, `external-sale.router`, `customer.router`. Os serviços têm testes de integração; o wiring HTTP não.
- **Fix sugerido:** seguir o padrão de `order.router.test.ts`/`user.router.test.ts`.

### 1.5 `simulateResponse` omite `variant_id`
- `src/schemas/cost.schema.ts` — a resposta do `POST /cost-components/simulate` não documenta o `variant_id` (o motor retorna, mas o schema não).

### 1.6 Teste do motor não cobre cenários-chave
- Duplicação de variante no mesmo pedido (funciona por alinhamento por índice, mas sem teste dedicado) e drift de arredondamento. (Dois testes foram adicionados na revisão final, mas ainda falta o de arredondamento.)

### 1.7 Nuvemshop `product/deleted` não tratado
- `src/routers/webhook.router.ts` — o evento `product/deleted` é apenas logado (`TODO`). Produtos excluídos na Nuvemshop não são desativados no AuraSync.

---

## 2. Bugs pré-existentes encontrados e contornados

> Estes bugs **não foram criados** por esta sessão — já estavam no repo e foram corrigidos como parte do trabalho.

### 2.1 `npm test` nunca terminava (travava no baseline)
O maior achado. Três causas:
1. **Testes de router quebravam na inicialização** (`inventory.router.test.ts`, `order.router.test.ts`, `user.router.test.ts`): faltavam `@fastify/cookie` (→ `request.cookies` undefined, 500 em toda rota POST) e os compilers zod (`setValidatorCompiler`/`setSerializerCompiler`) → erro `FST_ERR_SCH_VALIDATION_BUILD: data/required must be array`.
2. **Todos os testes de integração travavam no exit** (processo nunca fechava): o pool do knex não era destruído. Faltava `closeDatabase()` (i.e. `db.destroy()`) no `after` de quase todos os arquivos de teste.
3. **Expectativas de role defasadas**: testes esperavam que `EMPLOYEE` recebesse 200 em endpoints de leitura que foram endurecidos (commit `2529d26`) para exigir `ADMIN/SUPER_ADMIN` → atualizado para esperar 403.

**Correção:** registrados em `3769c77`, `b3c1036`, `c64fcd5`. Resultado: suíte verde (agora 108/108).

### 2.2 Alocação de `PER_ORDER` subestimava o custo total (Motor de Custos)
- O motor alocava cada componente `PER_ORDER` **apenas ao item que o possuía**, pela share daquele item. O restante do valor sumia → `orders.total_cost` subestimava o custo real.
- **Correção:** pool de todos os fees `PER_ORDER` do pedido, alocando cada um a **todos** os itens pela share (commit `0d5eb5c`).

### 2.3 Frete/fee por linha gravado em campo "por unidade" sem dividir pela quantidade
- O motor gravava a fatia do frete/fee (valor da **linha**) direto na coluna `unit_*` sem dividir por `quantity`. Com qtd > 1 o `total_cost` (Σ unit × qtd) superestimava (ex.: 82 vs 72 reais).
- **Correção:** dividir a alocação por `quantity` nas colunas `unit_*` (commit `cad51fb`).

### 2.4 Snapshot era recalculado a cada re-sync (violava histórico imutável)
- A cada webhook/upsert Nuvemshop (inclusive mudança de status), o motor recalculava o snapshot com os **valores atuais** dos componentes e sobrescrevia o congelado.
- **Decisão do usuário: congelar.** Agora, no re-sync de pedido já existente, as colunas de custo dos itens anteriores são **preservadas** (novas variantes ganham custo calculado na hora; totais recalculados a partir dos custos congelados × quantidades) — commit `615967f`.

### 2.5 `ExternalSaleCreate` era o tipo de SAÍDA (status obrigatório)
- `z.infer` com `.default('PAID')` gerava tipo com `status` obrigatório; chamadas sem `status` não compilavam (tsc).
- **Correção:** `ExternalSaleCreate = z.input<...>` (status opcional, default no parse) — commit `9a12d68`.

### 2.6 Auto-referência circular no `cost.schema.ts`
- `CostSchema` referenciava `CostSchema.base`/`CostSchema.associateResponse` dentro do próprio inicializador → erro TS2448/TS7022.
- **Correção:** hoisting de `base` e `associateResponse` para consts de módulo (padrão já usado em `order.schema.ts`).

### 2.7 Decimal retorna como string do Postgres
- Colunas `decimal(10,2)` voltam como **string** via `pg`. Todo consumidor precisa de `Number(...)` antes de aritmética (componentes, custos de variantes, totais).
- **Correção:** coerções aplicadas nos pontos de entrada do motor e na resposta da venda externa. **Regra para o futuro:** sempre coarzar decimal antes de somar.

---

## 3. Quirks/regras de design que ficaram para a próxima sessão (não são bugs)

- **`orders.source`** = `NUVEMSHOP | EXTERNAL` (nada mais). `createOrder` genérico usa `NUVEMSHOP` por padrão.
- **Categoria de componente** roteia o valor para a coluna do snapshot (`PACKAGING→unit_packaging_cost`, `TAX→unit_tax`, `FEE→unit_platform_fee`, etc.). Componentes continuam 100% dinâmicos; a categoria só mapeia para as colunas fixas.
- **`MONTHLY`** (contadora, pró-labore, etc.) é só controle — não participa do cálculo por venda (rateio futuro).
- **Cliente sem email**: o upsert **não cria** cliente (`upsertFromOrder` retorna `null`). Clientes são chaveados por email; pedidos sem email não geram registro (evita poluição/orfãos).
- **Upsert de cliente é best-effort**: envolto em try/catch nos services — falha não quebra o pedido já persistido nem o broadcast.
- **Rateio do desconto**: o desconto é alocado proporcionalmente por item apenas para cálculo de `unit_profit`/margem; o `total_amount` do pedido já é o valor líquido (pós-desconto).
- **Custo do produto** vem de `variant.cost_price` (não é componente). Produto **sem componentes** usa fallback legado (`packaging_cost` + `platform_fee_percent`).

---

## 4. Quirks conhecidos do repo (AGENTS.md — não resolvidos, cuidado)

- **⚠️ `npm test` APAGA os dados do banco de dev** — `cleanupDatabase()` (em `src/test/setup.ts`) trunca `orders`, `order_items`, `products`, `product_variants`, `customers`, tabelas de custo etc. Os testes de integração compartilham o MESMO banco (`DATABASE_URL`) e **não existe banco de teste isolado**. Rodar qualquer teste de integração destrói o catálogo/pedidos sincronizados. **Recomendação forte:** criar banco de teste dedicado (ex.: `aurasync_test`) e apontar `DATABASE_URL` para ele em ambiente de teste (ex.: `.env.test` + script `npm test` com `NODE_ENV=test`).
- **Preços inconsistentes**: `product.schema.ts` usa `z.int()` (centavos), `order.schema.ts` usa `z.number()` (decimal). Em campos novos, usar `z.number()` (decimal).
- **`user.schema.ts:49`**: `listResponse.id` tipado `z.number()` mas o DB usa UUID. Bug conhecido — usar `z.string().uuid()`.
- **Dead deps**: `express`, `@types/express`, `cors` no `package.json` (não usar; Fastify é o framework).
- **`nuvemshop.service.ts`** tem `console.log` de variáveis de ambiente em nível de módulo (side effect na importação — não replicar).
- **Estoque**: `inventory.repository.ts` muta `product_variants.stock_quantity` diretamente (bypass do service) — modelar estoque novo assim.
- **`cost.service.simulateCosts`** faz query crua (`db('product_variants')`) no service — desvio de camada conhecido; extrair para `productRepository.findVariantById` quando houver segundo uso.

---

## 5. Decisões que precisam de validação de produto (ficaram em aberto)

- **Datas dos pedidos corrigidas (2026-08-02, commit `2820e42`)**: `orders.created_at` agora vem do `created_at` da Nuvemshop (data real da venda) no primeiro insert; imutável em re-sync. Pedidos recém-sincronizados já nascem corretos. Atenção: pedidos antigos sincronizados ANTES desse fix continuam com a data do sync (não há backfill — foi desnecessário porque os testes apagaram os dados e o re-sync repovoou tudo com as datas corretas).
- **38 pedidos sem itens** (variantes não encontradas no sync de produtos — produtos excluídos/fora do catálogo): investigar cobertura do sync de produtos.
- **Ordem dos testes de router**: alguns arquivos dependem de estado de testes anteriores (ex.: cost service, customer service). Seguro com `--test-concurrency=1`, frágil a reordenação.
- **Favoritar/expor rota `GET /dashboard/stock` com `start_date`/`end_date`**: o endpoint aceita mas ignora os params (removidos do schema na revisão final — se quiser o filtro de data no estoque, implementar de verdade).
- **Recorrência de cliente** hoje é binária (`>1 pedido`); evoluir para níveis (2x, 3x...) quando o CRM chegar.
