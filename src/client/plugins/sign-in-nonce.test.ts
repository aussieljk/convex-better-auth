import { describe, expect, it } from "vitest";
import {
  createSignInNonce,
  DEFAULT_SIGN_IN_NONCE_KEY,
  getURLParam,
  setURLParam,
} from "./sign-in-nonce.js";
import type { SignInNonceStorage } from "./sign-in-nonce.js";

const memoryStorage = () => {
  const items = new Map<string, string>();
  const storage: SignInNonceStorage = {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
    removeItem: async (key) => void items.delete(key),
  };
  return { items, storage };
};

let counter = 0;
const randomUUID = () => `nonce-${++counter}`;

describe("createSignInNonce", () => {
  it("adds the stored nonce to a callback URL", () => {
    const { items, storage } = memoryStorage();
    const nonce = createSignInNonce({ storage, randomUUID });

    const url = nonce.callbackURL("https://app.example.com/");
    const value = items.get(DEFAULT_SIGN_IN_NONCE_KEY);

    expect(value).toBeTruthy();
    expect(url).toBe(`https://app.example.com/?nonce=${value}`);
    // One nonce serves every open request.
    expect(nonce.callbackURL("/done")).toBe(`/done?nonce=${value}`);
  });

  it("verifies a matching nonce one time", async () => {
    const { items, storage } = memoryStorage();
    const nonce = createSignInNonce({ storage, randomUUID });
    const url = `${nonce.callbackURL("https://app.example.com/")}&ott=abc`;

    expect(await nonce.verify(url)).toBe(true);
    expect(items.size).toBe(0);
    expect(await nonce.verify(url)).toBe(false);
  });

  it("refuses a foreign nonce and keeps the stored nonce", async () => {
    const { items, storage } = memoryStorage();
    const nonce = createSignInNonce({ storage, randomUUID });
    const real = nonce.callbackURL("https://app.example.com/");

    expect(
      await nonce.verify("https://app.example.com/?nonce=attacker&ott=abc")
    ).toBe(false);
    expect(await nonce.verify("https://app.example.com/?ott=abc")).toBe(false);
    expect(items.size).toBe(1);
    expect(await nonce.verify(`${real}&ott=abc`)).toBe(true);
  });

  it("refuses every URL when nothing is stored", async () => {
    const { storage } = memoryStorage();
    const nonce = createSignInNonce({ storage, randomUUID });
    expect(await nonce.verify("https://app.example.com/?nonce=&ott=abc")).toBe(
      false
    );
  });

  it("refuses every URL when storage throws", async () => {
    const storage: SignInNonceStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    const nonce = createSignInNonce({ storage, randomUUID });
    const url = nonce.callbackURL("https://app.example.com/");
    expect(await nonce.verify(`${url}&ott=abc`)).toBe(false);
  });

  it("uses a custom key and param, and works with app schemes", async () => {
    const { items, storage } = memoryStorage();
    const nonce = createSignInNonce({
      storage,
      randomUUID,
      key: "myapp.magic-link-nonce",
      param: "state",
    });
    const url = nonce.callbackURL("myapp://");
    expect(url).toMatch(/^myapp:\/\/\?state=nonce-\d+$/);
    expect(items.has("myapp.magic-link-nonce")).toBe(true);
    expect(await nonce.verify(`${url}&ott=abc`)).toBe(true);
  });
});

describe("URL params", () => {
  it("reads a param from the query and not the hash", () => {
    expect(getURLParam("https://a.com/?x=1&nonce=a%20b#nonce=c", "nonce")).toBe(
      "a b"
    );
    expect(getURLParam("https://a.com/#nonce=c", "nonce")).toBeNull();
    expect(getURLParam("myapp://?ott=t&nonce=n", "ott")).toBe("t");
  });

  it("replaces an earlier value and keeps the hash", () => {
    expect(setURLParam("/a?nonce=old&x=1#top", "nonce", "new")).toBe(
      "/a?x=1&nonce=new#top"
    );
    expect(setURLParam("/a", "nonce", "n")).toBe("/a?nonce=n");
  });
});
