### Running examples

**Note:** The examples are not starters - the dependencies are set up to work
locally within this repo. They can be adapted for standalone use, but are
intentionally not set up for it.

1. Clone or fork the repo
2. Install all dependencies from the root directory. This also installs the
   examples (Bun workspaces).

```bash
bun install
```

3. Go to the example directory

```bash
cd examples/<example-name>
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

<!-- END: Include on https://convex.dev/components -->
