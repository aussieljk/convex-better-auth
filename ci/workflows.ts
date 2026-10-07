/**
 * The repo's CI/CD, in TypeScript. `bun run workflows` renders this file to
 * `.github/workflows/*.yml`. Do not edit the YAML by hand. CI checks that it
 * matches.
 *
 * The workflows are split by branch, so the checks never run twice on a commit:
 *
 *   ci.yml              pull requests. Runs the full check and the e2e tests.
 *
 *   release.yml         every push to main, plus a manual button (Actions >
 *                       Release > Run workflow). Runs the same check, then
 *                       publishes to npm and pushes the version commit.
 *                       On a push it publishes only when the push changed what
 *                       ships (`release.ts --if-changed`). A manual run always
 *                       publishes.
 *
 *   lint-workflows.yml  actionlint and zizmor on the workflow files.
 *
 * npm needs no token. The release publishes with OIDC (trusted publishing),
 * which is set up for this repo and `release.yml` on npmjs.com. The filename is
 * part of that config. If you rename release.yml, update npmjs.com first.
 */
import {
  actionlint,
  checkout,
  install,
  setupBun,
  setupNode,
  sh,
  zizmor,
  type Runner,
  type Step,
  type Workflow,
} from "./dsl.ts";
import root from "../package.json" with { type: "json" };

/** GitHub-hosted. npm trusted publishing does not accept self-hosted runners. */
const RUNNER: Runner = "ubuntu-latest";

/** Trusted publishing needs npm >= 11.5.1. Node 24 ships npm 11. */
const NODE_VERSION = "24";

/** The same bun as the lockfile, from `packageManager`. */
const BUN_VERSION = root.packageManager.replace("bun@", "");

const MAIN = "main";

/** Only for the first publish. See scripts/release.ts. */
const FIRST_PUBLISH_ENV = { NPM_TOKEN: "${{ secrets.NPM_TOKEN }}" };

/** The gate both workflows run before anything else. */
const check: Step[] = [
  sh("Workflows in sync", "bun run workflows:check"),
  sh("Build", "bun run build"),
  sh("Test", "bun run test"),
  sh("Typecheck", "bun run typecheck"),
  sh("Lint", "bun run lint"),
  sh(
    "Install Playwright",
    "cd e2e && bunx playwright install --with-deps chromium"
  ),
  sh("E2E tests", "cd e2e && bun run test"),
];

const ci: Workflow = {
  name: "CI",
  // Pull requests only. A push to main runs release.yml, which runs the same check.
  on: { pull_request: { branches: ["**"] } },
  // One run for each branch. A new push cancels the run in progress.
  concurrency: {
    group: "ci-${{ github.head_ref || github.run_id }}",
    "cancel-in-progress": true,
  },
  permissions: { contents: "read" },
  jobs: {
    check: {
      name: "Check",
      "runs-on": RUNNER,
      "timeout-minutes": 30,
      steps: [
        checkout(),
        setupBun(BUN_VERSION),
        install(),
        ...check,
        // A test build of this PR on pkg.pr.new. Needs the pkg.pr.new GitHub app.
        sh(
          "Publish preview package",
          'bunx pkg-pr-new publish || echo "pkg-pr-new is not set up for this repo"'
        ),
      ],
    },
  },
};

const release: Workflow = {
  name: "Release",
  on: {
    push: { branches: [MAIN] },
    workflow_dispatch: {},
  },
  // Never run two releases at the same time, and never cancel one mid-publish.
  concurrency: { group: "release", "cancel-in-progress": false },
  // contents: push the version commit to main.
  // id-token: mint the OIDC token that npm trades for publish rights.
  permissions: { contents: "write", "id-token": "write" },
  jobs: {
    release: {
      name: "Check + publish",
      "runs-on": RUNNER,
      "timeout-minutes": 30,
      if: `github.ref == 'refs/heads/${MAIN}'`,
      steps: [
        // fetch-depth: the --if-changed gate diffs against the previous push.
        // A depth-1 clone has no previous commit, so the gate would always publish.
        checkout({ fetchDepth: 100, persistCredentials: true }),
        setupBun(BUN_VERSION),
        setupNode(NODE_VERSION),
        install(),
        ...check,
        // Never set NODE_AUTH_TOKEN here. With it, npm uses token auth and skips
        // trusted publishing. NPM_TOKEN is only for the first publish of the
        // package, and release.ts refuses to run with it after that.
        sh("Publish to npm", "bun scripts/release.ts --if-changed", {
          if: "github.event_name == 'push'",
          env: { ...FIRST_PUBLISH_ENV },
        }),
        sh("Publish to npm (manual)", "bun scripts/release.ts", {
          if: "github.event_name == 'workflow_dispatch'",
          env: { ...FIRST_PUBLISH_ENV },
        }),
      ],
    },
  },
};

const WORKFLOW_PATHS = [".github/workflows/**", ".github/actions/**", "ci/**"];

const lintWorkflows: Workflow = {
  name: "Lint workflows",
  on: {
    push: { branches: [MAIN], paths: [...WORKFLOW_PATHS] },
    pull_request: { branches: ["**"], paths: [...WORKFLOW_PATHS] },
  },
  concurrency: {
    group: "lint-workflows-${{ github.head_ref || github.run_id }}",
    "cancel-in-progress": true,
  },
  permissions: { contents: "read" },
  jobs: {
    actionlint: {
      name: "actionlint",
      "runs-on": RUNNER,
      "timeout-minutes": 5,
      steps: [checkout(), actionlint()],
    },
    zizmor: {
      name: "zizmor",
      "runs-on": RUNNER,
      "timeout-minutes": 5,
      permissions: { "security-events": "write" },
      steps: [checkout(), zizmor()],
    },
  },
};

/** Filename to workflow. The generator treats this map as all of `.github/workflows`. */
export const workflows: Record<string, Workflow> = {
  "ci.yml": ci,
  "release.yml": release,
  "lint-workflows.yml": lintWorkflows,
};
