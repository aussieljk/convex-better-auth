import type { AuthClient } from "./index.js";
import type { createAuthClient } from "better-auth/react";
import type { crossDomainClient } from "../client/plugins/index.js";

type CrossDomainAuthClient = ReturnType<
  typeof createAuthClient<{
    plugins: [ReturnType<typeof crossDomainClient>];
  }>
>;

/**
 * Trades the `?ott=` in the page URL for a session, as
 * ConvexBetterAuthProvider does when it mounts. It removes the ott from the
 * URL first. If `verifyOneTimeToken` is given and does not return true, it
 * does not trade the ott. Exported for tests.
 *
 * @internal
 */
export async function tradeOneTimeToken({
  authClient,
  location,
  history,
  verifyOneTimeToken,
}: {
  authClient: AuthClient;
  location: { href: string };
  history: { replaceState: (data: unknown, unused: string, url: URL) => void };
  verifyOneTimeToken?: (
    url: string,
    token: string
  ) => boolean | Promise<boolean>;
}): Promise<boolean> {
  const href = location.href;
  const url = new URL(href);
  const token = url.searchParams.get("ott");
  if (!token) {
    return false;
  }
  const authClientWithCrossDomain =
    authClient as unknown as CrossDomainAuthClient;
  url.searchParams.delete("ott");
  history.replaceState({}, "", url);
  if (verifyOneTimeToken && !(await verifyOneTimeToken(href, token))) {
    return false;
  }
  const result =
    await authClientWithCrossDomain.crossDomain.oneTimeToken.verify({
      token,
    });
  const session = result.data?.session;
  if (!session) {
    return false;
  }
  await authClient.getSession({
    fetchOptions: {
      headers: {
        Authorization: `Bearer ${session.token}`,
      },
    },
  });
  authClientWithCrossDomain.updateSession();
  return true;
}
