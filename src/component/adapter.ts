import { createApi } from "../client/index.js";
import { options } from "../auth-options.js";
import schema from "./schema.js";

export const {
  create,
  findOne,
  findMany,
  updateOne,
  updateMany,
  incrementOne,
  deleteOne,
  deleteMany,
  deleteUserData,
} = createApi(schema, () => options);
