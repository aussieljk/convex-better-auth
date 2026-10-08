/// <reference types="vite/client" />

import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import type { BetterAuthOptions } from "better-auth";
import { api } from "../component/_generated/api.js";
import schema from "../component/schema.js";
import { createClient } from "./index.js";
import type { DataModel } from "../component/_generated/dataModel.js";

const setup = () => {
  const t = convexTest(schema, import.meta.glob("../component/**/*.*s"));
  const ctx = {
    runQuery: t.query.bind(t),
    runMutation: t.mutation.bind(t),
  } as any;
  const adapter = createClient<DataModel>({ adapter: api.adapter } as any, {
    verbose: false,
  }).adapter(ctx)({} as BetterAuthOptions);
  return { t, adapter };
};

const createVerification = (adapter: ReturnType<typeof setup>["adapter"]) =>
  adapter.create<Record<string, unknown>, { id: string }>({
    model: "verification",
    data: {
      identifier: "magic-link-token",
      value: "user@example.com",
      expiresAt: new Date(Date.now() + 60_000),
    },
  });

describe("consumeOne", () => {
  it("deletes the row and returns it in Better Auth shape", async () => {
    const { adapter } = setup();
    const created = await createVerification(adapter);

    const consumed = await adapter.consumeOne<{
      id: string;
      identifier: string;
      value: string;
    }>({
      model: "verification",
      where: [{ field: "identifier", value: "magic-link-token" }],
    });

    expect(consumed?.id).toBe(created.id);
    expect(consumed?.value).toBe("user@example.com");
    expect(consumed).not.toHaveProperty("_id");
    expect(
      await adapter.findOne({
        model: "verification",
        where: [{ field: "id", value: created.id }],
      })
    ).toBeNull();
  });

  it("returns null when the row is already gone", async () => {
    const { adapter } = setup();
    await createVerification(adapter);
    const where = [{ field: "identifier", value: "magic-link-token" }];

    expect(
      await adapter.consumeOne({ model: "verification", where })
    ).not.toBeNull();
    expect(
      await adapter.consumeOne({ model: "verification", where })
    ).toBeNull();
  });

  it("gives the row to only one of two calls at the same time", async () => {
    const { adapter } = setup();
    await createVerification(adapter);
    const where = [{ field: "identifier", value: "magic-link-token" }];

    const results = await Promise.all([
      adapter.consumeOne({ model: "verification", where }),
      adapter.consumeOne({ model: "verification", where }),
    ]);

    expect(results.filter((result) => result !== null)).toHaveLength(1);
  });

  it("works inside a transaction", async () => {
    const { adapter } = setup();
    const created = await createVerification(adapter);

    const consumed = await adapter.transaction((trx) =>
      trx.consumeOne<{ id: string }>({
        model: "verification",
        where: [{ field: "identifier", value: "magic-link-token" }],
      })
    );

    expect(consumed?.id).toBe(created.id);
  });
});
