import { createApi } from '@aussieljk/convex-better-auth'
import schema from './schema'
import { createAuthOptions } from '../auth'

export const {
  create,
  findOne,
  findMany,
  updateOne,
  updateMany,
  deleteOne,
  deleteMany,
} = createApi(schema, createAuthOptions)
