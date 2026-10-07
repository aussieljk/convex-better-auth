import { createAuthClient } from "better-auth/react";
import {
  convexClient,
  crossDomainClient,
} from "@aussieljk/convex-better-auth/client/plugins";
import { magicLinkClient, emailOTPClient } from "better-auth/client/plugins";

export const authClient = createAuthClient({
  baseURL: import.meta.env.VITE_CONVEX_SITE_URL,
  plugins: [
    magicLinkClient(),
    emailOTPClient(),
    crossDomainClient(),
    convexClient(),
  ],
});
