import { describe, expect, it, vi } from "vitest";
import { tradeOneTimeToken } from "./one-time-token.js";
import type { AuthClient } from "./index.js";

const setup = (href: string) => {
  const verify = vi.fn(async () => ({
    data: { session: { token: "session-token" } },
  }));
  const authClient = {
    crossDomain: { oneTimeToken: { verify } },
    getSession: vi.fn(async () => ({})),
    updateSession: vi.fn(),
  } as unknown as AuthClient;
  const replaceState = vi.fn();
  return {
    verify,
    authClient,
    replaceState,
    run: (
      verifyOneTimeToken?: (
        url: string,
        token: string
      ) => boolean | Promise<boolean>
    ) =>
      tradeOneTimeToken({
        authClient,
        location: { href },
        history: { replaceState },
        verifyOneTimeToken,
      }),
  };
};

describe("tradeOneTimeToken", () => {
  it("does nothing when the URL has no ott", async () => {
    const { run, verify, replaceState } = setup("https://app.example.com/");
    expect(await run()).toBe(false);
    expect(verify).not.toHaveBeenCalled();
    expect(replaceState).not.toHaveBeenCalled();
  });

  it("trades every ott when there is no gate (the default)", async () => {
    const { run, verify, replaceState } = setup(
      "https://app.example.com/?ott=abc"
    );
    expect(await run()).toBe(true);
    expect(verify).toHaveBeenCalledWith({ token: "abc" });
    expect(String(replaceState.mock.calls[0]?.[2])).toBe(
      "https://app.example.com/"
    );
  });

  it("does not trade the ott when the gate refuses it", async () => {
    const { run, verify, replaceState } = setup(
      "https://app.example.com/?nonce=attacker&ott=abc"
    );
    const gate = vi.fn(async () => false);
    expect(await run(gate)).toBe(false);
    expect(gate).toHaveBeenCalledWith(
      "https://app.example.com/?nonce=attacker&ott=abc",
      "abc"
    );
    expect(verify).not.toHaveBeenCalled();
    // The ott is still removed from the URL.
    expect(String(replaceState.mock.calls[0]?.[2])).toBe(
      "https://app.example.com/?nonce=attacker"
    );
  });

  it("trades the ott when the gate accepts it", async () => {
    const { run, verify } = setup("https://app.example.com/?nonce=n&ott=abc");
    expect(await run(() => true)).toBe(true);
    expect(verify).toHaveBeenCalledWith({ token: "abc" });
  });
});
