/**
 * Deterministic demo dataset for the portfolio: a crystal-jewelry store with ~6 months
 * of Nuvemshop-shaped orders. Pure functions only; seed-demo.ts writes it through the
 * real services, so costs, stock and customers follow the same rules as production.
 */

export interface DemoVariant {
  nuvemshop_variant_id: string;
  name: string;
  sku: string;
  price: number;
  cost_price: number;
  stock_quantity: number;
}

export interface DemoProduct {
  nuvemshop_id: string;
  name: string;
  category: string;
  subgroup: 'Anéis' | 'Brincos' | 'Colares' | 'Pulseiras' | 'Decoração';
  variants: DemoVariant[];
}

/** Raw order in the Nuvemshop REST shape, so it goes through the same mapper as the real sync. */
export interface DemoNuvemshopOrder {
  id: number;
  number: number;
  status: 'open' | 'closed' | 'cancelled';
  payment_status: 'paid' | 'pending' | 'refunded';
  shipping_status: 'unpacked' | 'shipped' | 'delivered';
  total: string;
  discount: string;
  shipping_cost_owner: string;
  shipping_cost_customer: string;
  contact_email: string;
  contact_name: string;
  customer: { name: string };
  products: Array<{ variant_id: number; quantity: number; price: string }>;
  created_at: string;
  paid_at: string | null;
  shipped_at: string | null;
  completed_at: { date: string; timezone_type: number; timezone: string } | null;
  cancelled_at: string | null;
  gateway: string;
  payment_details: { method: string; installments: number };
  shipping_address: { city: string; province: string };
  shipping_carrier_name: string;
  storefront: 'mobile' | 'store';
  customer_visit: { utm_parameters: { utm_source?: string; utm_medium?: string; utm_campaign?: string } };
}

export function assertDemoDatabase(url: string | undefined): void {
  const name = url ? new URL(url).pathname.slice(1) : '';
  if (!name.endsWith('_demo')) {
    throw new Error(`Refusing to seed demo data into "${name || '(no DATABASE_URL)'}": the database name must end with _demo.`);
  }
}

/** Small deterministic PRNG (mulberry32): the same seed always produces the same store. */
export function createRng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min: number, max: number) => min + Math.floor(next() * (max - min + 1)),
    pick: <T>(items: readonly T[]) => items[Math.floor(next() * items.length)]!,
    weighted: <T>(items: ReadonlyArray<readonly [T, number]>) => {
      const total = items.reduce((s, [, w]) => s + w, 0);
      let r = next() * total;
      for (const [item, w] of items) {
        if ((r -= w) < 0) return item;
      }
      return items[items.length - 1]![0];
    },
  };
}
export type Rng = ReturnType<typeof createRng>;

const STONES = ['Ametista', 'Quartzo Rosa', 'Citrino', 'Turmalina Negra', 'Água-Marinha', 'Pedra da Lua', 'Sodalita', 'Labradorita'];
const TYPES: Array<{ base: string; subgroup: DemoProduct['subgroup']; category: string; price: number }> = [
  { base: 'Anel', subgroup: 'Anéis', category: 'Anéis', price: 69 },
  { base: 'Brinco', subgroup: 'Brincos', category: 'Brincos', price: 59 },
  { base: 'Colar', subgroup: 'Colares', category: 'Pingentes', price: 89 },
  { base: 'Pulseira', subgroup: 'Pulseiras', category: 'Pulseiras', price: 49 },
];

export function buildDemoCatalog(): DemoProduct[] {
  const products: DemoProduct[] = [];
  let id = 1000;
  let variantId = 50_000;
  STONES.forEach((stone, s) => {
    TYPES.slice(0, s % 2 === 0 ? 4 : 3).forEach((type, t) => {
      const base = type.price + (s % 3) * 10;
      const finishes = (s + t) % 2 === 0 ? ['Prata', 'Dourado'] : ['Prata'];
      products.push({
        nuvemshop_id: String(++id),
        name: `${type.base} ${stone}`,
        category: type.category,
        subgroup: type.subgroup,
        variants: finishes.map((finish, f) => ({
          nuvemshop_variant_id: String(++variantId),
          name: finish,
          sku: `${type.base.slice(0, 2).toUpperCase()}-${stone.slice(0, 3).toUpperCase()}-${finish[0]}`,
          price: base + f * 15,
          cost_price: Math.round((base + f * 15) * 0.32),
          stock_quantity: 400,
        })),
      });
    });
  });
  products.push({
    nuvemshop_id: String(++id),
    name: 'Drusa de Ametista',
    category: 'Decoração',
    subgroup: 'Decoração',
    variants: [{ nuvemshop_variant_id: String(++variantId), name: 'Padrão', sku: 'DR-AME', price: 149, cost_price: 55, stock_quantity: 120 }],
  });
  return products;
}

const FIRST = ['Ana', 'Beatriz', 'Camila', 'Daniela', 'Eduarda', 'Fernanda', 'Gabriela', 'Helena', 'Isabela', 'Juliana', 'Larissa', 'Mariana', 'Natália', 'Patrícia', 'Rafaela', 'Sofia', 'Tatiane', 'Vitória', 'Bruno', 'Lucas'];
const LAST = ['Silva', 'Souza', 'Oliveira', 'Costa', 'Pereira', 'Almeida', 'Rocha', 'Lima', 'Carvalho', 'Ribeiro'];
const PLACES: ReadonlyArray<readonly [{ city: string; province: string }, number]> = [
  [{ city: 'São Paulo', province: 'São Paulo' }, 30],
  [{ city: 'Campinas', province: 'São Paulo' }, 8],
  [{ city: 'Rio de Janeiro', province: 'Rio de Janeiro' }, 15],
  [{ city: 'Belo Horizonte', province: 'Minas Gerais' }, 9],
  [{ city: 'Curitiba', province: 'Paraná' }, 8],
  [{ city: 'Porto Alegre', province: 'Rio Grande do Sul' }, 7],
  [{ city: 'Florianópolis', province: 'Santa Catarina' }, 6],
  [{ city: 'Salvador', province: 'Bahia' }, 5],
  [{ city: 'Recife', province: 'Pernambuco' }, 4],
  [{ city: 'Brasília', province: 'Distrito Federal' }, 5],
];
const TRAFFIC: ReadonlyArray<readonly [DemoNuvemshopOrder['customer_visit']['utm_parameters'], number]> = [
  [{ utm_source: 'ig', utm_medium: 'paid', utm_campaign: 'colecao_cristais' }, 30],
  [{ utm_source: 'ig', utm_medium: 'social' }, 18],
  [{}, 25],
  [{ utm_source: 'fb', utm_medium: 'paid', utm_campaign: 'remarketing' }, 10],
  [{ utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'marca' }, 9],
  [{ utm_source: 'IGShopping', utm_medium: 'Social' }, 4],
];

const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString();

/** ~6 months of orders, growing over time, with more sales on weekends and evenings. */
export function buildDemoOrders(catalog: DemoProduct[], rng: Rng, today: Date, days = 180): DemoNuvemshopOrder[] {
  const customers = Array.from({ length: 160 }, (_, i) => {
    const first = rng.pick(FIRST);
    const last = rng.pick(LAST);
    return { name: `${first} ${last}`, email: `${first}.${last}.${i}@exemplo.com`.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''), place: rng.weighted(PLACES) };
  });
  const variants = catalog.flatMap((p) => p.variants);
  const orders: DemoNuvemshopOrder[] = [];
  let id = 900_000;
  let number = 1000;

  for (let d = days; d >= 0; d--) {
    const day = new Date(today.getTime() - d * DAY);
    const weekend = [0, 6].includes(day.getUTCDay());
    const growth = 1 + (days - d) / days; // the store grows over the period
    const count = Math.max(0, Math.round((rng.next() * 2 + (weekend ? 1.2 : 0.4)) * growth));

    for (let n = 0; n < count; n++) {
      // Store-local hours, mostly afternoon/evening (stored as UTC = local + 3h).
      const hour = rng.weighted([[9, 1], [11, 2], [13, 2], [15, 2], [18, 3], [20, 4], [22, 2]] as const) + rng.int(0, 1);
      const createdAt = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), hour + 3, rng.int(0, 59)));
      if (createdAt.getTime() > today.getTime()) continue;

      const customer = rng.next() < 0.3 ? customers[rng.int(0, 24)]! : rng.pick(customers); // a loyal core
      const lines = Array.from({ length: rng.weighted([[1, 6], [2, 3], [3, 1]] as const) }, () => {
        const v = rng.pick(variants);
        return { variant_id: Number(v.nuvemshop_variant_id), quantity: rng.weighted([[1, 8], [2, 2]] as const), price: v.price };
      });
      const subtotal = lines.reduce((s, l) => s + l.price * l.quantity, 0);
      const discount = rng.next() < 0.2 ? Math.round(subtotal * 0.1) : 0;
      const freeShipping = subtotal >= 150;
      const shippingCustomer = freeShipping ? 0 : 18.9;
      const method = rng.weighted([['pix', 55], ['credit_card', 38], ['boleto', 7]] as const);
      const ageDays = (today.getTime() - createdAt.getTime()) / DAY;
      const cancelled = rng.next() < 0.05;
      const paid = !cancelled && (method !== 'boleto' || rng.next() < 0.8);
      const shipped = paid && ageDays > 2;
      const delivered = shipped && ageDays > 8;

      orders.push({
        id: ++id,
        number: ++number,
        status: cancelled ? 'cancelled' : delivered ? 'closed' : 'open',
        payment_status: cancelled ? (rng.next() < 0.5 ? 'refunded' : 'pending') : paid ? 'paid' : 'pending',
        shipping_status: delivered ? 'delivered' : shipped ? 'shipped' : 'unpacked',
        total: (subtotal - discount + shippingCustomer).toFixed(2),
        discount: discount.toFixed(2),
        shipping_cost_owner: (freeShipping ? 21.5 : 0).toFixed(2),
        shipping_cost_customer: shippingCustomer.toFixed(2),
        contact_email: customer.email,
        contact_name: customer.name,
        customer: { name: customer.name },
        products: lines.map((l) => ({ ...l, price: l.price.toFixed(2) })),
        created_at: iso(createdAt),
        paid_at: paid ? iso(new Date(createdAt.getTime() + 20 * 60_000)) : null,
        shipped_at: shipped ? iso(new Date(createdAt.getTime() + 2 * DAY)) : null,
        completed_at: delivered ? { date: iso(new Date(createdAt.getTime() + 7 * DAY)), timezone_type: 3, timezone: 'America/Sao_Paulo' } : null,
        cancelled_at: cancelled ? iso(new Date(createdAt.getTime() + DAY)) : null,
        gateway: method === 'pix' ? rng.weighted([['nuvem-pago', 3], ['mercadopago', 2]] as const) : rng.weighted([['nuvem-pago', 2], ['mercadopago', 2], ['pagseguro', 1]] as const),
        payment_details: { method, installments: method === 'credit_card' ? rng.weighted([[1, 5], [2, 2], [3, 3], [6, 1]] as const) : 1 },
        shipping_address: customer.place,
        shipping_carrier_name: rng.pick(['Correios PAC', 'Correios SEDEX', 'Jadlog']),
        storefront: rng.next() < 0.78 ? 'mobile' : 'store',
        customer_visit: { utm_parameters: rng.weighted(TRAFFIC) },
      });
    }
  }
  return orders;
}
