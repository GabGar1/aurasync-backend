import { describe, it } from "node:test";
import assert from "node:assert";
import { runInBatches } from "./batch.js";

describe("runInBatches", () => {
  it("never runs more than `size` tasks at the same time and keeps the order of results", async () => {
    let running = 0;
    let peak = 0;
    const started: number[] = [];

    const results = await runInBatches([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      started.push(n);
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 5));
      running--;
      return n * 10;
    });

    assert.strictEqual(peak, 3);
    assert.deepStrictEqual(results, [10, 20, 30, 40, 50, 60, 70]);
    assert.deepStrictEqual(started, [1, 2, 3, 4, 5, 6, 7]);
  });

  it("does not start any task before the previous batch finished", async () => {
    const events: string[] = [];
    await runInBatches(["a", "b", "c"], 2, async (x) => {
      events.push(`start:${x}`);
      await new Promise((r) => setTimeout(r, 5));
      events.push(`end:${x}`);
    });
    assert.ok(events.indexOf("start:c") > events.indexOf("end:a"));
    assert.ok(events.indexOf("start:c") > events.indexOf("end:b"));
  });

  it("returns an empty array for no items", async () => {
    assert.deepStrictEqual(await runInBatches([], 5, async () => 1), []);
  });
});
