/// <reference types="vite/client" />

import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { anyApi, defineSchema, defineTable } from "convex/server";
import { api } from "../component/_generated/api.js";
import { options } from "../auth-options.js";
import schema from "../component/schema.js";
import { createApi } from "./create-api.js";

const now = Date.now();

const setup = async (sessions: number) => {
  const t = convexTest(schema, import.meta.glob("../component/**/*.*s"));
  const ids = await t.run(async (ctx) => {
    const insertUser = (email: string) =>
      ctx.db.insert("user", {
        name: email,
        email,
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      });
    const userId = await insertUser("a@example.com");
    const otherId = await insertUser("b@example.com");
    for (const id of [userId, otherId]) {
      for (let i = 0; i < sessions; i++) {
        await ctx.db.insert("session", {
          token: `${id}-${i}`,
          userId: id,
          expiresAt: now + 60_000,
          createdAt: now,
          updatedAt: now,
        });
      }
      await ctx.db.insert("account", {
        accountId: id,
        providerId: "credential",
        userId: id,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("twoFactor", {
        secret: "secret",
        backupCodes: "codes",
        userId: id,
      });
    }
    return { userId, otherId };
  });
  const count = (userId: string) =>
    t.run(async (ctx) => ({
      users: (await ctx.db.query("user").collect()).filter(
        (u) => u._id === userId
      ).length,
      session: (
        await ctx.db
          .query("session")
          .withIndex("userId", (q) => q.eq("userId", userId))
          .collect()
      ).length,
      account: (
        await ctx.db
          .query("account")
          .withIndex("userId", (q) => q.eq("userId", userId))
          .collect()
      ).length,
      twoFactor: (
        await ctx.db
          .query("twoFactor")
          .withIndex("userId", (q) => q.eq("userId", userId))
          .collect()
      ).length,
    }));
  return { t, ...ids, count };
};

describe("deleteUserData", () => {
  it("deletes the user and the rows that sign them in", async () => {
    const { t, userId, otherId, count } = await setup(3);

    const result = await t.mutation(api.adapter.deleteUserData, { userId });

    expect(result).toEqual({ isDone: true, deleted: 6 });
    expect(await count(userId)).toMatchObject({
      users: 0,
      session: 0,
      account: 0,
      twoFactor: 0,
    });
    // Other users keep their rows.
    expect(await count(otherId)).toMatchObject({
      users: 1,
      session: 3,
      account: 1,
      twoFactor: 1,
    });
  });

  it("stops at the limit and deletes the user last", async () => {
    const { t, userId, count } = await setup(5);

    const first = await t.mutation(api.adapter.deleteUserData, {
      userId,
      limit: 4,
    });
    expect(first).toEqual({ isDone: false, deleted: 4 });
    expect((await count(userId)).users).toBe(1);

    const second = await t.mutation(api.adapter.deleteUserData, {
      userId,
      limit: 4,
    });
    expect(second).toEqual({ isDone: true, deleted: 4 });
    expect(await count(userId)).toMatchObject({
      users: 0,
      session: 0,
      account: 0,
      twoFactor: 0,
    });
  });

  it("is done when the user does not exist", async () => {
    const { t } = await setup(0);
    expect(
      await t.mutation(api.adapter.deleteUserData, { userId: "not-an-id" })
    ).toEqual({ isDone: true, deleted: 0 });
  });

  it("names the missing index and deletes nothing", async () => {
    // The default schema, but the session table has no userId index.
    const noIndexSchema = defineSchema({
      ...schema.tables,
      session: defineTable(schema.tables.session.validator).index("token", [
        "token",
      ]),
    });
    const t = convexTest(noIndexSchema, {
      ...import.meta.glob("../component/**/*.*s"),
      "../component/noIndex.ts": async () =>
        createApi(noIndexSchema, () => options),
    });
    const userId = await t.run((ctx) =>
      ctx.db.insert("user", {
        name: "a",
        email: "a@example.com",
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      })
    );

    await expect(
      t.mutation(anyApi.noIndex.deleteUserData, { userId })
    ).rejects.toThrow(
      'deleteUserData needs an index on session.userId. Add .index("userId", ["userId"])'
    );
    expect(await t.run((ctx) => ctx.db.get("user", userId))).not.toBeNull();
  });
});
