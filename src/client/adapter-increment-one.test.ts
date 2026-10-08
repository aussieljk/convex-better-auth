/// <reference types="vite/client" />

import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import type { BetterAuthOptions } from "better-auth";
import { api } from "../component/_generated/api.js";
import schema from "../component/schema.js";
import { createClient } from "./index.js";
import type { DataModel } from "../component/_generated/dataModel.js";

type RateLimit = {
  id: string;
  key: string;
  count: number;
  lastRequest: number;
};

const setup = () => {
  const t = convexTest(schema, import.meta.glob("../component/**/*.*s"));
  const ctx = {
    runQuery: t.query.bind(t),
    runMutation: t.mutation.bind(t),
  } as any;
  const adapter = createClient<DataModel>({ adapter: api.adapter } as any, {
    verbose: false,
  }).adapter(ctx)({
    // Puts the rateLimit model in the Better Auth schema.
    rateLimit: { storage: "database" },
  } as BetterAuthOptions);
  return { t, adapter };
};

const createRateLimit = (
  adapter: ReturnType<typeof setup>["adapter"],
  count = 0
) =>
  adapter.create<Record<string, unknown>, RateLimit>({
    model: "rateLimit",
    data: { key: "sign-in:1.2.3.4", count, lastRequest: 1 },
  });

const where = [{ field: "key", value: "sign-in:1.2.3.4" }];

describe("incrementOne", () => {
  it("adds the delta, sets the fields and returns the row", async () => {
    const { adapter } = setup();
    const created = await createRateLimit(adapter, 2);

    const result = await adapter.incrementOne<RateLimit>({
      model: "rateLimit",
      where,
      increment: { count: 1 },
      set: { lastRequest: 5 },
    });

    expect(result).toMatchObject({
      id: created.id,
      count: 3,
      lastRequest: 5,
    });
    expect(result).not.toHaveProperty("_id");
    expect(
      await adapter.findOne<RateLimit>({
        model: "rateLimit",
        where: [{ field: "id", value: created.id }],
      })
    ).toMatchObject({ count: 3, lastRequest: 5 });
  });

  it("returns null when the guard matches no row", async () => {
    const { adapter } = setup();
    await createRateLimit(adapter, 3);

    const result = await adapter.incrementOne({
      model: "rateLimit",
      where: [...where, { field: "count", operator: "lt", value: 3 }],
      increment: { count: 1 },
    });

    expect(result).toBeNull();
    expect(
      await adapter.findOne<RateLimit>({ model: "rateLimit", where })
    ).toMatchObject({ count: 3 });
  });

  it("does not lose an increment when calls run at the same time", async () => {
    const { adapter } = setup();
    await createRateLimit(adapter);

    await Promise.all(
      Array.from({ length: 10 }, () =>
        adapter.incrementOne({
          model: "rateLimit",
          where,
          increment: { count: 1 },
        })
      )
    );

    expect(
      await adapter.findOne<RateLimit>({ model: "rateLimit", where })
    ).toMatchObject({ count: 10 });
  });

  it("stops at the guard when calls run at the same time", async () => {
    const { adapter } = setup();
    await createRateLimit(adapter);

    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        adapter.incrementOne({
          model: "rateLimit",
          where: [...where, { field: "count", operator: "lt", value: 3 }],
          increment: { count: 1 },
        })
      )
    );

    expect(results.filter((result) => result !== null)).toHaveLength(3);
    expect(
      await adapter.findOne<RateLimit>({ model: "rateLimit", where })
    ).toMatchObject({ count: 3 });
  });

  it("works inside a transaction", async () => {
    const { adapter } = setup();
    await createRateLimit(adapter);

    const result = await adapter.transaction((trx) =>
      trx.incrementOne<RateLimit>({
        model: "rateLimit",
        where,
        increment: { count: 2 },
      })
    );

    expect(result?.count).toBe(2);
  });
});
