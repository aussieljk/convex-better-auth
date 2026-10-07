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
