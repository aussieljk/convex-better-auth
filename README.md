# Convex + Better Auth

> This package is a community fork of
> [`@convex-dev/better-auth`](https://github.com/get-convex/better-auth). It
> supports the latest Better Auth release. To use it, install
> `@aussieljk/convex-better-auth` and import from
> `@aussieljk/convex-better-auth` in place of `@convex-dev/better-auth`. All of
> the APIs are the same.
>
> ```sh
> bun add @aussieljk/convex-better-auth better-auth convex
> ```

## Security helpers

Version 0.14.0 adds three security fixes to the package. Before, each app kept
its own copy. All of them are backward compatible.

### 1. Atomic `consumeOne` in the adapter

Better Auth uses `consumeOne` to read and delete a one-time value: a magic link,
an email code or a reset token. The adapter now calls the component `deleteOne`
mutation, which finds and deletes the row in one transaction. Only the request
that deleted the row gets it, so a token works one time, also when two requests
use it at the same time. A `transaction` callback gets the same adapter.

**Migration.** In `convex/auth.ts`, remove the `database` wrapper that adds
`consumeOne` and `transaction`. Use the adapter directly:

```ts
export const createAuthOptions = (ctx: GenericCtx<DataModel>) =>
  ({
    database: authComponent.adapter(ctx),
    // ...
  }) satisfies BetterAuthOptions;
```

Then remove the imports that only the wrapper used (for example `FunctionArgs`
and the `AuthModel` type).

### 1b. Atomic `incrementOne` in the adapter (0.14.1)

Better Auth uses `incrementOne` for counters: two factor attempts, backup
codes, the organization plugin, device authorization and the database rate
limiter. The adapter now calls the component `incrementOne` mutation, which
finds the row, checks the where clause and writes the new values in one
transaction. No increment is lost when requests run at the same time.

**Migration.** Nothing for the default install. For a local install, add
`incrementOne` to the exports of `convex/betterAuth/adapter.ts` (see below).
Without it, the adapter uses the Better Auth fallback, which can throw a
contention error under load.

### 2. `deleteUserData` for the delete-account path

The component has a `deleteUserData` mutation. It deletes the user and the rows
that sign them in: `session`, `account` (OAuth links and the password hash),
`passkey` and `twoFactor`. It skips a table that is not in your schema. One call
deletes at most `limit` rows (default 500), and deletes the user row last. If
the result is `{ isDone: false }`, call it again.

It is a component function, so only your app can call it. Your app must make
sure that the caller is the user.

Each of these tables needs an index that starts with its `userId` field. The
generated schema has one, named `userId`. If an index is missing,
`deleteUserData` deletes nothing and throws an error that names the table and
the index to add.

**Migration.**

1. For a local install, add `deleteUserData` (and `incrementOne`, from 0.14.1)
   to the exports of `convex/betterAuth/adapter.ts`:

   ```ts
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
   } = createApi(schema, createAuthOptions);
   ```

2. Remove your own delete-user mutation (for example
   `convex/betterAuth/users.ts`).
3. In your delete-account mutation, after you delete the app data, call:

   ```ts
   const { isDone } = await ctx.runMutation(
     components.betterAuth.adapter.deleteUserData,
     { userId: identity.subject }
   );
   if (!isDone) {
     await ctx.scheduler.runAfter(0, internal.account.finishDelete, {
       userId: identity.subject,
     });
   }
   ```

   A person usually has a small number of rows, so one call is almost always
   enough.

### 3. A sign-in nonce for the one-time token (ott)

With the cross domain plugin, OAuth and magic links come back with `?ott=`, and
`ConvexBetterAuthProvider` trades it for a session. An attacker can make an ott
for their own account and send the link to a victim. Then the victim's browser
signs in to the attacker's account. To stop this, put a nonce in each callback
URL, and trade the ott only when the URL brings back the same nonce.

```ts
// auth-client.ts
import { createSignInNonce } from "@aussieljk/convex-better-auth/client/plugins";

export const signInNonce = createSignInNonce();

// Use it for every sign-in that can come back with an ott.
await authClient.signIn.magicLink({
  email,
  callbackURL: signInNonce.callbackURL(`${window.location.origin}/`),
});
await authClient.signIn.social({
  provider: "google",
  callbackURL: signInNonce.callbackURL(`${window.location.origin}/`),
});
```

```tsx
// provider.tsx
<ConvexBetterAuthProvider
  client={convex}
  authClient={authClient}
  verifyOneTimeToken={signInNonce.verify}
>
  {children}
</ConvexBetterAuthProvider>
```

The nonce is in localStorage, because a magic link usually opens in a new tab.
One nonce serves all open requests, and a match removes it. A link with a
different nonce does not remove it, so a foreign link cannot break a real link.
Without `verifyOneTimeToken`, the provider trades every ott, as before.

Options: `key` (the storage key, default `better-auth.sign-in-nonce`), `param`
(the URL parameter, default `nonce`), `storage` and `randomUUID`.

**React Native (Expo).** The same helper works with expo-secure-store and
expo-crypto:

```ts
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";

export const magicLinkNonce = createSignInNonce({
  key: "myapp.magic-link-nonce",
  storage: {
    getItem: (key) => SecureStore.getItem(key),
    setItem: (key, value) => SecureStore.setItem(key, value),
    removeItem: (key) => SecureStore.deleteItemAsync(key),
  },
  randomUUID: Crypto.randomUUID,
});

// Ask for the link.
await authClient.signIn.magicLink({
  email,
  callbackURL: magicLinkNonce.callbackURL("myapp://"),
});

// When the app opens `myapp://?nonce=...&ott=...`:
if (!(await magicLinkNonce.verify(url))) {
  return { error: { message: "This phone did not ask for this link." } };
}
await authClient.$fetch("/cross-domain/one-time-token/verify", {
  method: "POST",
  body: { token: ott },
});
```

**Migration.**

1. Remove your own nonce code: the storage key constant, the functions that make
   and read the nonce, and the `Proxy` around the auth client (often called
   `gateOneTimeToken` or `providerAuthClient`).
2. Make one `signInNonce` with `createSignInNonce()`. To keep links that are
   open now, set `key` to your old storage key.
3. Change each callback URL to `signInNonce.callbackURL(url)`.
4. Give the provider the plain auth client and
   `verifyOneTimeToken={signInNonce.verify}`.
5. In a native app, replace the nonce check before
   `/cross-domain/one-time-token/verify` with `await nonce.verify(url)`.

<!-- START: Include on https://convex.dev/components -->

Use [Better Auth](https://better-auth.com) with
[Convex](https://www.convex.dev).

**Full documentation and guides:
[labs.convex.dev/better-auth](https://labs.convex.dev/better-auth)**

### Framework Agnostic

**Support for popular frameworks.**

Supports popular frameworks, including React, Vue, Svelte, Astro, Solid,
Next.js, Nuxt, Tanstack Start, Hono, and more.

### Authentication

**Email & Password Authentication.**

Built-in support for email and password authentication, with session and account
management features.

### Social Sign-on

**Support multiple OAuth providers.**

Allow users to sign in with their accounts, including GitHub, Google, Discord,
Twitter, and more.

### Two Factor

**Multi Factor Authentication.**

Secure your users accounts with two factor authentication with a few lines of
code.

<!-- END: Include on https://convex.dev/components -->
