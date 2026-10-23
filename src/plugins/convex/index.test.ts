import { describe, expect, it } from "vitest";
import type { AuthConfig } from "convex/server";
import { betterAuth } from "better-auth/minimal";
import { memoryAdapter } from "better-auth/adapters/memory";
import { convex } from "./index.js";

const authConfig = {
  providers: [{ applicationID: "convex", domain: "https://example.com" }],
} satisfies AuthConfig;

const getJwtSetCookieMatcher = () => {
  const plugin = convex({ authConfig });
  const afterHooks = plugin.hooks?.after ?? [];
  const matcher = afterHooks.find((hook) => {
    return (
      hook.matcher({
        path: "/sign-in/email",
        context: { session: { id: "s1" } },
      } as unknown as Parameters<typeof hook.matcher>[0]) &&
      !hook.matcher({
        path: "/sign-out",
        context: { session: null },
      } as unknown as Parameters<typeof hook.matcher>[0])
    );
  })?.matcher;
  if (!matcher) {
    throw new Error("Failed to find Convex JWT set-cookie after hook matcher");
  }
  return matcher;
};

describe("convex plugin JWT cookie refresh matcher", () => {
  it("matches update-session", () => {
    const matcher = getJwtSetCookieMatcher();
    type MatcherContext = Parameters<typeof matcher>[0];
    const ctx = {
      path: "/update-session",
      context: { session: { id: "s1" } },
    };
    expect(matcher(ctx as unknown as MatcherContext)).toBe(true);
  });

  it("matches get-session only when a session exists", () => {
    const matcher = getJwtSetCookieMatcher();
    type MatcherContext = Parameters<typeof matcher>[0];
    const withSessionCtx = {
      path: "/get-session",
      context: { session: { id: "s1" } },
    };
    const withoutSessionCtx = {
      path: "/get-session",
      context: { session: null },
    };
    expect(matcher(withSessionCtx as unknown as MatcherContext)).toBe(true);
    expect(matcher(withoutSessionCtx as unknown as MatcherContext)).toBe(false);
  });
});

describe("convex plugin OpenID configuration", () => {
  it("serves issuer and jwks_uri for the Convex site", async () => {
    process.env.CONVEX_SITE_URL = "https://example.convex.site";
    const auth = betterAuth({
      baseURL: "https://example.convex.site",
      secret: "test-secret-at-least-thirty-two-characters-long",
      database: memoryAdapter({ user: [], session: [], jwks: [] }),
      plugins: [convex({ authConfig })],
    });
    const response = await auth.handler(
      new Request(
        "https://example.convex.site/api/auth/convex/.well-known/openid-configuration"
      )
    );
    expect(response.status).toBe(200);
    const config = (await response.json()) as Record<string, unknown>;
    expect(config.issuer).toBe("https://example.convex.site");
    expect(config.jwks_uri).toBe(
      "https://example.convex.site/api/auth/convex/jwks"
    );
  });
});

describe("convex plugin JWT cookie on a failed sign-in", () => {
  it("gives 401 and logs no internal error for a wrong password", async () => {
    process.env.CONVEX_SITE_URL = "https://example.convex.site";
    const errors: unknown[] = [];
    const auth = betterAuth({
      baseURL: "https://example.convex.site",
      secret: "test-secret-at-least-thirty-two-characters-long",
      database: memoryAdapter({
        user: [],
        session: [],
        account: [],
        verification: [],
        jwks: [],
      }),
      emailAndPassword: { enabled: true },
      logger: {
        log: (level, ...args) => {
          if (level === "error") errors.push(args);
        },
      },
      plugins: [convex({ authConfig })],
    });
    await auth.api.signUpEmail({
      body: { email: "a@example.com", password: "right-password", name: "A" },
    });
    const response = await auth.handler(
      new Request("https://example.convex.site/api/auth/sign-in/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "a@example.com",
          password: "wrong-password",
        }),
      })
    );
    expect(response.status).toBe(401);
    expect(errors).toEqual([]);
  });
});
