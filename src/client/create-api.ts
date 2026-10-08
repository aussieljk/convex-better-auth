import {
  mutationGeneric,
  paginationOptsValidator,
  queryGeneric,
} from "convex/server";
import type { FunctionHandle, SchemaDefinition } from "convex/server";
import { v } from "convex/values";
import type { GenericId } from "convex/values";
import { asyncMap } from "convex-helpers";
import { partial } from "convex-helpers/validators";
import {
  adapterWhereValidator,
  checkUniqueFields,
  hasUniqueFields,
  listOne,
  paginate,
  selectFields,
} from "./adapter-utils.js";
import { getAuthTables } from "better-auth/db";
import type { TableNames } from "../component/_generated/dataModel.js";
import type { BetterAuthOptions } from "better-auth/minimal";

const whereValidator = (
  schema: SchemaDefinition<any, any>,
  tableName: TableNames
) =>
  v.object({
    field: v.union(
      ...Object.keys(schema.tables[tableName].validator.fields).map((field) =>
        v.literal(field)
      ),
      v.literal("_id")
    ),
    operator: v.optional(
      v.union(
        v.literal("lt"),
        v.literal("lte"),
        v.literal("gt"),
        v.literal("gte"),
        v.literal("eq"),
        v.literal("in"),
        v.literal("not_in"),
        v.literal("ne"),
        v.literal("contains"),
        v.literal("starts_with"),
        v.literal("ends_with")
      )
    ),
    value: v.union(
      v.string(),
      v.number(),
      v.boolean(),
      v.array(v.string()),
      v.array(v.number()),
      v.null()
    ),
    connector: v.optional(v.union(v.literal("AND"), v.literal("OR"))),
    mode: v.optional(v.union(v.literal("sensitive"), v.literal("insensitive"))),
  });

export const createApi = <Schema extends SchemaDefinition<any, any>>(
  schema: Schema,
  createAuthOptions: (ctx: any) => BetterAuthOptions
) => {
  const betterAuthSchema = getAuthTables(createAuthOptions({} as any));
  return {
    create: mutationGeneric({
      args: {
        input: v.union(
          ...Object.entries(schema.tables).map(([model, table]) =>
            v.object({
              model: v.literal(model),
              data: v.object((table as any).validator.fields),
            })
          )
        ),
        select: v.optional(v.array(v.string())),
        onCreateHandle: v.optional(v.string()),
      },
      handler: async (ctx, args) => {
        await checkUniqueFields(
          ctx,
          schema,
          betterAuthSchema,
          args.input.model,
          args.input.data
        );
        const id = await ctx.db.insert(
          args.input.model as any,
          args.input.data
        );
        const doc = await ctx.db.get(args.input.model, id);
        if (!doc) {
          throw new Error(`Failed to create ${args.input.model}`);
        }
        const result = selectFields(doc, args.select);
        if (args.onCreateHandle) {
          await ctx.runMutation(
            args.onCreateHandle as FunctionHandle<"mutation">,
            {
              model: args.input.model,
              doc,
            }
          );
          const updatedDoc = await ctx.db.get(args.input.model, id);
          if (!updatedDoc) {
            throw new Error(
              `Failed to create ${args.input.model} (deleted by onCreate trigger?)`
            );
          }
          return selectFields(updatedDoc, args.select);
        }
        return result;
      },
    }),
    findOne: queryGeneric({
      args: {
        model: v.union(
          ...Object.keys(schema.tables).map((model) => v.literal(model))
        ),
        where: v.optional(v.array(adapterWhereValidator)),
        select: v.optional(v.array(v.string())),
        join: v.optional(v.any()),
      },
      handler: async (ctx, args) => {
        return await listOne(ctx, schema, betterAuthSchema, args);
      },
    }),
    findMany: queryGeneric({
      args: {
        model: v.union(
          ...Object.keys(schema.tables).map((model) => v.literal(model))
        ),
        where: v.optional(v.array(adapterWhereValidator)),
        select: v.optional(v.array(v.string())),
        limit: v.optional(v.number()),
        sortBy: v.optional(
          v.object({
            direction: v.union(v.literal("asc"), v.literal("desc")),
            field: v.string(),
          })
        ),
        offset: v.optional(v.number()),
        join: v.optional(v.any()),
        paginationOpts: paginationOptsValidator,
      },
      handler: async (ctx, args) => {
        return await paginate(ctx, schema, betterAuthSchema, args);
      },
    }),
    updateOne: mutationGeneric({
      args: {
        input: v.union(
          ...Object.entries(schema.tables).map(
            ([name, table]: [string, Schema["tables"][string]]) => {
              const tableName = name as TableNames;
              const fields = partial(table.validator.fields);
              return v.object({
                model: v.literal(tableName),
                update: v.object(fields),
                where: v.optional(v.array(whereValidator(schema, tableName))),
              });
            }
          )
        ),
        onUpdateHandle: v.optional(v.string()),
      },
      handler: async (ctx, args) => {
        const doc = await listOne(ctx, schema, betterAuthSchema, args.input);
        // Better Auth's adapter contract expects null when no row matches
        if (!doc) {
          return null;
        }
        await checkUniqueFields(
          ctx,
          schema,
          betterAuthSchema,
          args.input.model,
          args.input.update,
          doc
        );
        await ctx.db.patch(
          args.input.model,
          doc._id as GenericId<TableNames>,
          args.input.update as any
        );
        const updatedDoc = await ctx.db.get(
          args.input.model,
          doc._id as GenericId<TableNames>
        );
        if (!updatedDoc) {
          throw new Error(`Failed to update ${args.input.model}`);
        }
        if (args.onUpdateHandle) {
          await ctx.runMutation(
            args.onUpdateHandle as FunctionHandle<"mutation">,
            {
              model: args.input.model,
              newDoc: updatedDoc,
              oldDoc: doc,
            }
          );
          const innerUpdatedDoc = await ctx.db.get(
            args.input.model,
            doc._id as GenericId<TableNames>
          );
          if (!innerUpdatedDoc) {
            throw new Error(
              `Failed to update ${args.input.model} (deleted by onUpdate trigger?)`
            );
          }
          return innerUpdatedDoc;
        }
        return updatedDoc;
      },
    }),
    updateMany: mutationGeneric({
      args: {
        input: v.union(
          ...Object.entries(schema.tables).map(
            ([name, table]: [string, Schema["tables"][string]]) => {
              const tableName = name as TableNames;
              const fields = partial(table.validator.fields);
              return v.object({
                model: v.literal(tableName),
                update: v.object(fields),
                where: v.optional(v.array(whereValidator(schema, tableName))),
              });
            }
          )
        ),
        paginationOpts: paginationOptsValidator,
        onUpdateHandle: v.optional(v.string()),
      },
      handler: async (ctx, args) => {
        const { page, ...result } = await paginate(
          ctx,
          schema,
          betterAuthSchema,
          {
            ...args.input,
            paginationOpts: args.paginationOpts,
          }
        );
        if (args.input.update) {
          if (
            hasUniqueFields(
              betterAuthSchema,
              args.input.model,
              args.input.update ?? {}
            ) &&
            page.length > 1
          ) {
            throw new Error(
              `Attempted to set unique fields in multiple documents in ${args.input.model} with the same value. Fields: ${Object.keys(args.input.update ?? {}).join(", ")}`
            );
          }
          await asyncMap(page, async (doc) => {
            await checkUniqueFields(
              ctx,
              schema,
              betterAuthSchema,
              args.input.model,
              args.input.update ?? {},
              doc
            );
            await ctx.db.patch(
              args.input.model,
              doc._id as GenericId<TableNames>,
              args.input.update as any
            );

            if (args.onUpdateHandle) {
              await ctx.runMutation(
                args.onUpdateHandle as FunctionHandle<"mutation">,
                {
                  model: args.input.model,
                  newDoc: await ctx.db.get(
                    args.input.model,
                    doc._id as GenericId<TableNames>
                  ),
                  oldDoc: doc,
                }
              );
            }
          });
        }
        return {
          ...result,
          count: page.length,
          ids: page.map((doc) => doc._id),
        };
      },
    }),
    deleteOne: mutationGeneric({
      args: {
        input: v.union(
          ...Object.keys(schema.tables).map((name: string) => {
            const tableName = name as TableNames;
            return v.object({
              model: v.literal(tableName),
              where: v.optional(v.array(whereValidator(schema, tableName))),
            });
          })
        ),
        onDeleteHandle: v.optional(v.string()),
      },
      handler: async (ctx, args) => {
        const doc = await listOne(ctx, schema, betterAuthSchema, args.input);
        if (!doc) {
          return;
        }
        await ctx.db.delete(args.input.model, doc._id as GenericId<TableNames>);
        if (args.onDeleteHandle) {
          await ctx.runMutation(
            args.onDeleteHandle as FunctionHandle<"mutation">,
            { model: args.input.model, doc }
          );
        }
        return doc;
      },
    }),
    deleteMany: mutationGeneric({
      args: {
        input: v.union(
          ...Object.keys(schema.tables).map((name: string) => {
            const tableName = name as TableNames;
            return v.object({
              model: v.literal(tableName),
              where: v.optional(v.array(whereValidator(schema, tableName))),
            });
          })
        ),
        paginationOpts: paginationOptsValidator,
        onDeleteHandle: v.optional(v.string()),
      },
      handler: async (ctx, args) => {
        const { page, ...result } = await paginate(
          ctx,
          schema,
          betterAuthSchema,
          {
            ...args.input,
            paginationOpts: args.paginationOpts,
          }
        );
        await asyncMap(page, async (doc) => {
          if (args.onDeleteHandle) {
            await ctx.runMutation(
              args.onDeleteHandle as FunctionHandle<"mutation">,
              {
                model: args.input.model,
                doc,
              }
            );
          }
          await ctx.db.delete(
            args.input.model,
            doc._id as GenericId<TableNames>
          );
        });
        return {
          ...result,
          count: page.length,
          ids: page.map((doc) => doc._id),
        };
      },
    }),
    /**
     * Deletes a Better Auth user and the rows that sign them in: sessions,
     * linked accounts (OAuth and the password hash), passkeys and two factor
     * secrets. A table that is not in the schema is skipped. Use it in the
     * delete-account path of your app, after your app deletes its own data.
     *
     * This is a component function, so only your app can call it. Your app
     * must make sure that the caller is the user.
     *
     * One call deletes at most `limit` rows (default 500). The user row is
     * deleted last, only when no other row is left. If the result has
     * `isDone: false`, call it again (for example from the scheduler).
     */
    deleteUserData: mutationGeneric({
      args: {
        userId: v.string(),
        limit: v.optional(v.number()),
        onDeleteHandle: v.optional(v.string()),
      },
      handler: async (ctx, args) => {
        const limit = Math.max(1, args.limit ?? DELETE_USER_DATA_LIMIT);
        let deleted = 0;
        const deleteDoc = async (model: string, doc: any) => {
          await ctx.db.delete(model as any, doc._id);
          deleted++;
          if (args.onDeleteHandle) {
            await ctx.runMutation(
              args.onDeleteHandle as FunctionHandle<"mutation">,
              { model, doc }
            );
          }
        };
        for (const model of USER_DATA_MODELS) {
          const table = betterAuthSchema[model];
          const tableName = table?.modelName ?? model;
          if (!schema.tables[tableName]) {
            continue;
          }
          const field = table?.fields.userId?.fieldName ?? "userId";
          while (deleted < limit) {
            const rows = await ctx.db
              .query(tableName as any)
              .withIndex(field, (q: any) => q.eq(field, args.userId))
              .take(Math.min(DELETE_USER_DATA_BATCH, limit - deleted));
            for (const row of rows) {
              await deleteDoc(tableName, row);
            }
            if (rows.length === 0) {
              break;
            }
          }
          if (deleted >= limit) {
            return { isDone: false, deleted };
          }
        }
        const userTable = betterAuthSchema.user?.modelName ?? "user";
        const userId = ctx.db.normalizeId(userTable as any, args.userId);
        const user = userId ? await ctx.db.get(userTable as any, userId) : null;
        if (user) {
          await deleteDoc(userTable, user);
        }
        return { isDone: true, deleted };
      },
    }),
  };
};

/** The Better Auth models with a `userId` field that deleteUserData clears. */
const USER_DATA_MODELS = ["session", "account", "passkey", "twoFactor"];
const DELETE_USER_DATA_LIMIT = 500;
const DELETE_USER_DATA_BATCH = 100;
