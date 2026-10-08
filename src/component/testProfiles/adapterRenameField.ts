import { createApi } from "../../client/index.js";
import { renameFieldProfileOptions } from "./auth-options.profile-rename-joins.js";
import schema from "./schema.profile-plugin-table.js";

export const {
  create,
  findOne,
  findMany,
  updateOne,
  updateMany,
  incrementOne,
  deleteOne,
  deleteMany,
} = createApi(schema, () => renameFieldProfileOptions);
