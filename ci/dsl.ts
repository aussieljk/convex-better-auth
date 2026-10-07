/**
 * Typed GitHub Actions DSL. This is the only file that knows the Actions schema.
 *
 * Workflows are written in `ci/workflows.ts`. `ci/generate.ts` renders them to
 * `.github/workflows/*.yml` (`bun run workflows`).
 *
 * Keep every `run` on a single line. Bun's YAML writer writes multi-line strings
 * as quoted scalars with \n escapes, which are hard to read. Put longer logic in
 * a `scripts/*.ts` file.
 */

export type Runner = "ubuntu-latest";

export type Permissions = Partial<
  Record<"contents" | "id-token" | "security-events", "read" | "write" | "none">
>;

export type Env = Record<string, string>;

export type Step = {
  name?: string;
  if?: string;
  uses?: string;
  with?: Record<string, string | number | boolean>;
  run?: string;
  env?: Env;
};

export type Job = {
  name?: string;
  "runs-on": Runner;
  if?: string;
  permissions?: Permissions;
  "timeout-minutes"?: number;
  steps: Step[];
};

export type Triggers = {
  push?: { branches?: string[]; paths?: string[] };
  pull_request?: { branches?: string[]; paths?: string[] };
  workflow_dispatch?: Record<string, never>;
};

export type Workflow = {
  name: string;
  on: Triggers;
  permissions: Permissions;
  concurrency?: { group: string; "cancel-in-progress": boolean };
  jobs: Record<string, Job>;
};

// Actions are pinned to a commit SHA, because zizmor (lint-workflows.yml)
// requires it. The comment on each line gives the tag.
const ACTIONS = {
  checkout: "actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd", // v6
  setupBun: "oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6", // v2.2.0
  setupNode: "actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e", // v6
  actionlint:
    "raven-actions/actionlint@205b530c5d9fa8f44ae9ed59f341a0db994aa6f8", // v2.1.2
  zizmor: "zizmorcore/zizmor-action@5f14fd08f7cf1cb1609c1e344975f152c7ee938d", // v0.5.6
};

/** A shell step. */
export const sh = (
  name: string,
  run: string,
  extra: Omit<Step, "name" | "run" | "uses"> = {}
): Step => ({ name, run, ...extra });

/**
 * `persistCredentials` is false by default. The release job sets it to true,
 * because it pushes the version commit with GITHUB_TOKEN.
 */
export const checkout = (
  opts: { fetchDepth?: number; persistCredentials?: boolean } = {}
): Step => ({
  name: "Checkout",
  uses: ACTIONS.checkout,
  with: {
    "persist-credentials": opts.persistCredentials ?? false,
    ...(opts.fetchDepth === undefined
      ? {}
      : { "fetch-depth": opts.fetchDepth }),
  },
});

export const setupBun = (version: string): Step => ({
  name: "Setup bun",
  uses: ACTIONS.setupBun,
  with: { "bun-version": version },
});

/** Only the release needs node: `npm publish` does the OIDC exchange. */
export const setupNode = (version: string): Step => ({
  name: "Setup node",
  uses: ACTIONS.setupNode,
  with: { "node-version": version },
});

export const install = (): Step =>
  sh("Install", "bun install --frozen-lockfile");

export const actionlint = (): Step => ({
  name: "actionlint",
  uses: ACTIONS.actionlint,
});

export const zizmor = (): Step => ({
  name: "zizmor",
  uses: ACTIONS.zizmor,
});

const HEADER = [
  "# GENERATED FILE. DO NOT EDIT.",
  "# Source: ci/workflows.ts. Run `bun run workflows` to regenerate.",
  "# CI fails if this file is different from the source (`bun run workflows:check`).",
].join("\n");

/** YAML text for one workflow, with the generated-file banner on top. */
export function render(workflow: Workflow): string {
  const yaml = Bun.YAML.stringify(workflow, null, 2)
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
  return `${HEADER}\n\n${yaml}\n`;
}
