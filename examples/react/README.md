## Convex + Better Auth + React

This example shows how to use Better Auth with Convex and React.

Note that dependencies are set up to work with the local component in this repo,
it is not set up for standalone use (but can be adapted).

### Running the example

1. Clone or fork the repo
2. Install all dependencies from the root directory. This also installs the
   examples (Bun workspaces).

```bash
bun install
```

3. Go to the example directory

```bash
cd examples/react
```

4. If you haven't run this example before, initialize the database

```bash
bunx convex dev --once
```

5. Run the example

```bash
bun run dev
```

`bun run dev` also rebuilds the component when you change files in `src/`.
