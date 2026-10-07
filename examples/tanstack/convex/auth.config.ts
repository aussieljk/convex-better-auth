import type { AuthConfig } from 'convex/server'
import { getAuthConfigProvider } from '@aussieljk/convex-better-auth/auth-config'

export default {
  providers: [getAuthConfigProvider()],
} satisfies AuthConfig
