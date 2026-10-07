import { isAuthError } from "@/lib/utils";
import { convexBetterAuthNextJs } from "@aussieljk/convex-better-auth/nextjs";

export const {
  handler,
  preloadAuthQuery,
  isAuthenticated,
  getToken,
  fetchAuthQuery,
  fetchAuthMutation,
  fetchAuthAction,
} = convexBetterAuthNextJs({
  convexUrl: process.env.NEXT_PUBLIC_CONVEX_URL!,
  convexSiteUrl: process.env.NEXT_PUBLIC_CONVEX_SITE_URL!,
  // Use experimental jwtCache for faster page loads
  jwtCache: {
    enabled: true,
    isAuthError,
  },
});
