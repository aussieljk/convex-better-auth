# Developing guide

This repo uses Bun workspaces. The root package is the library. The examples,
`e2e` and `docs` are workspaces that link to it.

## Running locally

```sh
bun install
bun run build
cd examples/react
bunx convex dev
```

## Testing

```sh
rm -rf dist/ && bun run build
bun run test
bun run typecheck
bun run lint
bun run test:e2e
```

## Building a one-off package

```sh
rm -rf dist/ && bun run build
bun pm pack
```

## Releasing

A push to `main` publishes to npm. The Release workflow (`release.yml`) runs the
full check, then `scripts/release.ts --if-changed`:

- If the push did not change `src/` or `package.json`, it does not publish.
- If npm already has the version in `package.json`, it bumps the patch version,
  publishes, and pushes a `chore: release x.y.z` commit and a `vx.y.z` tag.
- If npm does not have that version yet, it publishes that version. To release a
  new minor version, set it in `package.json` and push.

You can also start a release from Actions > Release > Run workflow.

The workflow publishes with npm trusted publishing (OIDC). There is no npm
token. Do not rename `release.yml`, because npmjs.com uses that filename.

### Trusted publisher on npmjs.com

The trusted publisher for `@aussieljk/convex-better-auth` is this repo
(`aussieljk/convex-better-auth`) and the workflow file `release.yml`. To see or
set it up again, run this with your npm login (it asks for 2FA):

```sh
npm trust list @aussieljk/convex-better-auth
npm trust github @aussieljk/convex-better-auth --file release.yml --repo aussieljk/convex-better-auth --allow-publish --yes
```

Do not give the Release workflow an npm token. `scripts/release.ts` stops if it
sees `NODE_AUTH_TOKEN` or `NPM_TOKEN`.

## CI workflows

The workflows are written in TypeScript in `ci/workflows.ts`. Do not edit
`.github/workflows/*.yml` by hand.

```sh
bun run workflows        # write the YAML
bun run workflows:check  # fail if the YAML is out of date
```
