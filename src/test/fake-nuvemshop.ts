import Fastify, { type FastifyInstance } from "fastify";

/**
 * Minimal stand-in for the Nuvemshop REST API, served over real HTTP so the
 * integration code (pagination, 429 handling, fetch-by-id) runs unmodified.
 */
export interface FakeNuvemshop {
  url: string;
  products: any[];
  orders: any[];
  /** Every request received, in order: path + query string. */
  requests: Array<{ path: string; query: Record<string, string> }>;
  /** Number of upcoming requests that must be answered with 429. */
  throttleNext: number;
  /** Number of upcoming requests that must be answered with 500. */
  failNext: number;
  /** Artificial latency per request, in ms. */
  delayMs: number;
  reset(): void;
  close(): Promise<void>;
}

export async function startFakeNuvemshop(storeId: string): Promise<FakeNuvemshop> {
  const app: FastifyInstance = Fastify();

  const state: FakeNuvemshop = {
    url: "",
    products: [],
    orders: [],
    requests: [],
    throttleNext: 0,
    failNext: 0,
    delayMs: 0,
    reset() {
      this.products = [];
      this.orders = [];
      this.requests = [];
      this.throttleNext = 0;
      this.failNext = 0;
      this.delayMs = 0;
    },
    close: () => app.close(),
  };

  app.addHook("onRequest", async (request, reply) => {
    const url = new URL(request.url, "http://fake");
    state.requests.push({ path: url.pathname, query: Object.fromEntries(url.searchParams) });
    if (state.delayMs) await new Promise((r) => setTimeout(r, state.delayMs));
    if (request.headers.authorization !== "bearer test-token") {
      return reply.code(401).send({ code: 401, message: "Unauthorized" });
    }
    if (state.throttleNext > 0) {
      state.throttleNext--;
      return reply.code(429).header("x-rate-limit-reset", "20").send({ code: 429, message: "Too Many Requests" });
    }
    if (state.failNext > 0) {
      state.failNext--;
      return reply.code(500).send({ code: 500, message: "Internal Server Error" });
    }
  });

  const paginate = (items: any[], query: any) => {
    const page = Number(query.page ?? 1);
    const perPage = Number(query.per_page ?? 30);
    const min = query.updated_at_min ? new Date(query.updated_at_min).getTime() : null;
    const filtered = min === null ? items : items.filter((i) => new Date(i.updated_at).getTime() >= min);
    const slice = filtered.slice((page - 1) * perPage, page * perPage);
    return { slice, total: filtered.length };
  };

  for (const resource of ["products", "orders"] as const) {
    app.get(`/v1/${storeId}/${resource}`, async (request, reply) => {
      const { slice, total } = paginate(state[resource], request.query);
      // Like the real API, a page past the end is answered with 404.
      if (slice.length === 0 && total > 0) return reply.code(404).send({ code: 404, message: "Last page is 1" });
      return reply.header("x-total-count", String(total)).send(slice);
    });
    app.get<{ Params: { id: string } }>(`/v1/${storeId}/${resource}/:id`, async (request, reply) => {
      const item = state[resource].find((i) => String(i.id) === request.params.id);
      if (!item) return reply.code(404).send({ code: 404, message: "Not Found" });
      return item;
    });
  }

  const address = await app.listen({ port: 0, host: "127.0.0.1" });
  state.url = `${address}/v1`;
  return state;
}
