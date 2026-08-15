import { describe, it } from "node:test";
import assert from "node:assert";
import { translateFulfillmentStatus } from "./order-status.js";

describe("translateFulfillmentStatus", () => {
  it("translates Nuvemshop fulfillment values to PT-BR", () => {
    assert.strictEqual(translateFulfillmentStatus("DELIVERED"), "Entregue");
    assert.strictEqual(translateFulfillmentStatus("UNPACKED"), "Empacotando");
    assert.strictEqual(translateFulfillmentStatus("DISPATCHED"), "Despachado");
    assert.strictEqual(
      translateFulfillmentStatus("MARKED_AS_FULFILLED"),
      "Marcado como Concluído"
    );
    assert.strictEqual(translateFulfillmentStatus("pending"), "Pendente");
    assert.strictEqual(translateFulfillmentStatus("PENDING"), "Pendente");
    assert.strictEqual(translateFulfillmentStatus(null), "Sem status");
  });
});