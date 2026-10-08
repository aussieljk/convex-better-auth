/**
 * A sign-in nonce for one-time token (ott) callbacks.
 *
 * OAuth and magic links come back to the app with `?ott=`, a one-time token
 * that the client trades for a session. An attacker can make an ott for their
 * own account and send the link to a victim. Then the victim's browser (or
 * phone) signs in to the attacker's account. To stop this, every callback URL
 * carries a random nonce that this device keeps, and the client trades an ott
 * only when the URL brings back the same nonce.
 *
 * On the web, the default storage is localStorage, not sessionStorage: a magic
 * link usually opens in a new tab, and sessionStorage is per tab. Other sites
 * cannot read the localStorage of this origin, so the nonce stays secret.
 *
 * This module has no browser or React Native imports, so it works in both. On
 * React Native, give it a storage (for example expo-secure-store) and a
 * `randomUUID` (for example from expo-crypto).
 */

/**
 * Where the nonce is kept. `getItem` and `setItem` must be synchronous,
 * because a callback URL is often made in a click handler. `removeItem` can
 * be asynchronous.
 */
export type SignInNonceStorage = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void | Promise<void>;
};

export type SignInNonceOptions = {
  /** Where the nonce is kept. The default is `localStorage`. */
  storage?: SignInNonceStorage;
  /** The storage key. The default is `better-auth.sign-in-nonce`. */
  key?: string;
  /** The URL query parameter. The default is `nonce`. */
  param?: string;
  /** Makes a new nonce. The default is `crypto.randomUUID()`. */
  randomUUID?: () => string;
};

export type SignInNonce = {
  /** The stored nonce. If there is no stored nonce, it makes and stores one. */
  get: () => string;
  /**
   * Returns `url` with the nonce as a query parameter. Use it for every
   * `callbackURL` that can come back with an ott. `url` can be absolute
   * (`https://app.example.com/`, `myapp://`) or relative (`/`).
   */
  callbackURL: (url: string) => string;
  /**
   * Returns true only when the nonce in `url` is the stored nonce. On a
   * match, it removes the stored nonce, so the nonce works one time. A URL
   * with a different nonce does not remove it, so a foreign link cannot
   * break a real link.
   */
  verify: (url: string) => Promise<boolean>;
};

export const DEFAULT_SIGN_IN_NONCE_KEY = "better-auth.sign-in-nonce";

const browserStorage = (): SignInNonceStorage | undefined => {
  try {
    return (globalThis as { localStorage?: SignInNonceStorage }).localStorage;
  } catch {
    // Access to localStorage can throw (for example, when storage is blocked).
    return undefined;
  }
};

const defaultRandomUUID = () => {
  const crypto = (globalThis as { crypto?: Crypto }).crypto;
  if (!crypto?.randomUUID) {
    throw new Error(
      "crypto.randomUUID is not available. Give createSignInNonce a randomUUID option."
    );
  }
  return crypto.randomUUID();
};

const splitURL = (url: string) => {
  const hashIndex = url.indexOf("#");
  const hash = hashIndex === -1 ? "" : url.slice(hashIndex);
  const withoutHash = hashIndex === -1 ? url : url.slice(0, hashIndex);
  const queryIndex = withoutHash.indexOf("?");
  return {
    base: queryIndex === -1 ? withoutHash : withoutHash.slice(0, queryIndex),
    query: queryIndex === -1 ? "" : withoutHash.slice(queryIndex + 1),
    hash,
  };
};

const decode = (value: string) => {
  try {
    return decodeURIComponent(value.replace(/\+/g, " "));
  } catch {
    return value;
  }
};

/**
 * Reads one query parameter from a URL. It does not use `URL`, because
 * `URL` and `URLSearchParams` are not complete in React Native.
 */
export const getURLParam = (url: string, name: string): string | null => {
  for (const pair of splitURL(url).query.split("&")) {
    const eq = pair.indexOf("=");
    const key = decode(eq === -1 ? pair : pair.slice(0, eq));
    if (key === name) {
      return eq === -1 ? "" : decode(pair.slice(eq + 1));
    }
  }
  return null;
};

/** Sets one query parameter on a URL, and removes earlier values of it. */
export const setURLParam = (url: string, name: string, value: string) => {
  const { base, query, hash } = splitURL(url);
  const pairs = query
    .split("&")
    .filter((pair) => pair !== "")
    .filter((pair) => {
      const eq = pair.indexOf("=");
      return decode(eq === -1 ? pair : pair.slice(0, eq)) !== name;
    });
  pairs.push(`${encodeURIComponent(name)}=${encodeURIComponent(value)}`);
  return `${base}?${pairs.join("&")}${hash}`;
};

/**
 * Makes a sign-in nonce. Use `callbackURL` for every sign-in that can come
 * back with an ott, and `verify` before the ott is traded.
 *
 * @example
 * ```ts
 * // auth-client.ts
 * export const signInNonce = createSignInNonce();
 * await authClient.signIn.magicLink({
 *   email,
 *   callbackURL: signInNonce.callbackURL(window.location.origin + "/"),
 * });
 *
 * // provider.tsx
 * <ConvexBetterAuthProvider
 *   client={convex}
 *   authClient={authClient}
 *   verifyOneTimeToken={signInNonce.verify}
 * >
 * ```
 */
export const createSignInNonce = (
  options: SignInNonceOptions = {}
): SignInNonce => {
  const key = options.key ?? DEFAULT_SIGN_IN_NONCE_KEY;
  const param = options.param ?? "nonce";
  const randomUUID = options.randomUUID ?? defaultRandomUUID;
  const storage = () => options.storage ?? browserStorage();

  const read = () => {
    try {
      return storage()?.getItem(key) ?? null;
    } catch {
      return null;
    }
  };

  const get = () => {
    const existing = read();
    if (existing) {
      return existing;
    }
    const nonce = randomUUID();
    try {
      storage()?.setItem(key, nonce);
    } catch {
      // No storage: verify will refuse the ott, so sign-in by link fails
      // safely.
    }
    return nonce;
  };

  const verify = async (url: string) => {
    const expected = read();
    if (!expected || getURLParam(url, param) !== expected) {
      return false;
    }
    try {
      await storage()?.removeItem(key);
    } catch {
      // Nothing to remove.
    }
    return true;
  };

  return {
    get,
    callbackURL: (url) => setURLParam(url, param, get()),
    verify,
  };
};
