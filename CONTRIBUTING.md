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

### First publish of a new package

OIDC cannot publish a package that is not on npm yet. For the first release
only:

1. On npmjs.com, go to Access Tokens > Generate New Token (granular). Give it
   read and write access to all packages, and turn on "Bypass two-factor
   authentication". Set a short expiry, for example 1 day.
2. In the GitHub repo, go to Settings > Secrets and variables > Actions and add
   it as `NPM_TOKEN`.
3. Run Actions > Release > Run workflow.
4. The workflow publishes and then runs `npm trust github` to set up trusted
   publishing. If that step fails, the job summary tells you how to set it up on
   npmjs.com by hand.
5. Delete the `NPM_TOKEN` secret and the token on npmjs.com. The next release
   refuses to run while the secret is set.

## CI workflows

The workflows are written in TypeScript in `ci/workflows.ts`. Do not edit
`.github/workflows/*.yml` by hand.

```sh
bun run workflows        # write the YAML
bun run workflows:check  # fail if the YAML is out of date
```
