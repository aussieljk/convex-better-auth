#!/usr/bin/env bun
/**
 * Publish the package to npm and push the version commit.
 *
 *   bun scripts/release.ts
 *   bun scripts/release.ts --if-changed   publish only if this push changed what ships
 *
 * It runs the same way on a laptop and in the Release workflow.
 *
 *   1. With --if-changed, stop if the push did not change `src/` or package.json.
 *   2. Refuse to run with uncommitted changes.
 *   3. In CI, make sure npm can publish with OIDC, and set a git identity.
 *   4. If npm already has the current version, bump the patch version.
 *      If not (for example, you set a new minor version by hand), publish it as is.
 *   5. Build and publish.
 *   6. If the version changed, commit package.json, src/version.ts and bun.lock,
 *      tag it, and push.
 *
 * There is no npm token. In CI, the `id-token: write` permission mints an OIDC
 * token that npm trades for publish rights, and npm adds provenance. On a laptop
 * it uses your `npm login` session.
 *
 * The one exception is the first publish. npm can only trust a workflow for a
 * package that already exists, so OIDC cannot publish a new package. For that
 * one release, the workflow uses the NPM_TOKEN secret, then runs
 * `npm trust github` to set up trusted publishing. After that, the script
 * refuses to run while NPM_TOKEN is set, so the secret gets deleted.
 *
 * The push uses GITHUB_TOKEN. GitHub does not start new workflow runs for those
 * pushes. This is important: the release commit changes package.json, so a push
 * that started a workflow would release again, forever.
 */
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import semver from "semver";

const ROOT = resolve(import.meta.dir, "..");
const CI = !!process.env.CI;

/** Trusted publishing came in npm 11.5.1. Older npm falls back to token auth. */
const MIN_NPM = "11.5.1";

/** A change to one of these changes the tarball, so it earns a release. */
const PUBLISHED_PATHS = ["src/", "package.json"];

function fail(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}

function step(message: string) {
  console.log(`\n\x1b[1m▸ ${message}\x1b[0m`);
}

/**
 * Run a command and stream its output. A non-zero exit stops the script,
 * unless `optional` is set. Returns true if the command passed.
 */
function run(
  cmd: string[],
  opts: { env?: Record<string, string>; optional?: boolean } = {}
): boolean {
  console.log(`$ ${cmd.join(" ")}`);
  const { exitCode } = Bun.spawnSync(cmd, {
    cwd: ROOT,
    env: { ...process.env, ...opts.env },
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  if (exitCode !== 0 && !opts.optional) {
    fail(`${cmd.join(" ")} failed (exit ${exitCode})`);
  }
  return exitCode === 0;
}

/** Run a command and return its stdout, or undefined if it fails. */
function capture(cmd: string[]): string | undefined {
  const { exitCode, stdout } = Bun.spawnSync(cmd, {
    cwd: ROOT,
    stderr: "pipe",
  });
  return exitCode === 0 ? stdout.toString().trim() : undefined;
}

/** Markdown for the GitHub Actions job summary. Does nothing locally. */
function summary(markdown: string) {
  const path = process.env.GITHUB_STEP_SUMMARY;
  if (path) appendFileSync(path, `${markdown}\n`);
}

const pkgPath = join(ROOT, "package.json");
const readPkg = () => JSON.parse(readFileSync(pkgPath, "utf8"));

/**
 * The files this push changed, or undefined if we cannot tell (a manual run, a
 * first push, or a clone without the previous commit). Undefined means "assume
 * it changed": a missed release is worse than a spare version number.
 */
function pushedFiles(): string[] | undefined {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) return undefined;
  let before: string | undefined;
  try {
    before = JSON.parse(readFileSync(eventPath, "utf8")).before;
  } catch {
    return undefined;
  }
  // All zeros is the first push to a branch, which has no diff base.
  if (!before || /^0+$/.test(before)) return undefined;
  return capture(["git", "diff", "--name-only", `${before}..HEAD`])
    ?.split("\n")
    .filter(Boolean);
}

if (process.argv.includes("--if-changed")) {
  const files = pushedFiles();
  const shipped = (file: string) =>
    PUBLISHED_PATHS.some((path) => file === path || file.startsWith(path));
  if (files && !files.some(shipped)) {
    step(
      `No change to ${PUBLISHED_PATHS.join(" or ")} in this push. No release.`
    );
    summary(
      "### 📦 No release\n\nNothing that ships changed, so the npm version is the same."
    );
    process.exit(0);
  }
}

step("Checking the working tree");
const dirty = capture(["git", "status", "--porcelain"]);
if (dirty) fail(`uncommitted changes. Commit or stash first:\n${dirty}`);

if (CI) {
  if (process.env.NODE_AUTH_TOKEN) {
    fail(
      "NODE_AUTH_TOKEN is set. npm would use token auth, not trusted publishing."
    );
  }
  const npm = capture(["npm", "--version"]) ?? "0.0.0";
  if (semver.lt(npm, MIN_NPM)) {
    step(`npm ${npm} is older than ${MIN_NPM}. Upgrading.`);
    run(["npm", "install", "-g", "npm@latest"]);
  }
  run(["git", "config", "user.name", "github-actions[bot]"]);
  run([
    "git",
    "config",
    "user.email",
    "41898282+github-actions[bot]@users.noreply.github.com",
  ]);
}

const { name, version: current } = readPkg();

// The first publish of a new package cannot use OIDC (see the top of this file).
const firstPublish = !capture(["npm", "view", name, "version"]);
const bootstrapToken = process.env.NPM_TOKEN || undefined;
if (bootstrapToken && !firstPublish) {
  fail(
    `${name} is on npm, so it publishes with trusted publishing now. ` +
      "Delete the NPM_TOKEN secret (repo > Settings > Secrets and variables > Actions) and the token on npmjs.com."
  );
}
if (CI && firstPublish && !bootstrapToken) {
  fail(
    `${name} is not on npm yet, and OIDC cannot do a first publish. ` +
      "Add an NPM_TOKEN secret for this one release (see CONTRIBUTING.md)."
  );
}
// npm reads the token from this file, so it never appears in a command line.
const npmEnv: Record<string, string> = {};
if (bootstrapToken) {
  const npmrc = join(tmpdir(), "release.npmrc");
  writeFileSync(npmrc, `//registry.npmjs.org/:_authToken=${bootstrapToken}\n`);
  npmEnv.NPM_CONFIG_USERCONFIG = npmrc;
}
const onNpm = capture(["npm", "view", `${name}@${current}`, "version"]);
const bumped = !!onNpm;

if (bumped) {
  const next = semver.inc(current, "patch")!;
  step(`${name}@${current} is on npm. Bumping to ${next}.`);
  const pkg = readPkg();
  pkg.version = next;
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
  run(["node", "scripts/sync-version.mjs"]);
  // bun.lock records the workspace version. Without this, the next
  // `bun install --frozen-lockfile` fails.
  run(["bun", "install", "--lockfile-only"]);
}

const released = readPkg().version as string;

step(`Publishing ${name}@${released}`);
run(["bun", "run", "build"]);
run(["npm", "publish", "--access", "public"], { env: npmEnv });

const repo = process.env.GITHUB_REPOSITORY;
let trustSetUp = false;
if (bootstrapToken && repo) {
  step("Setting up trusted publishing for the next releases");
  trustSetUp = run(
    [
      "npm",
      "trust",
      "github",
      name,
      "--file",
      "release.yml",
      "--repo",
      repo,
      "--yes",
    ],
    { env: npmEnv, optional: true }
  );
}

if (bumped) {
  step(`Committing ${released}`);
  run(["git", "commit", "-am", `chore: release ${released}`]);
}
run(["git", "tag", `v${released}`]);

// HEAD:<branch>, so this works from the CI checkout and from a local branch.
const branch =
  process.env.GITHUB_REF_NAME ??
  capture(["git", "rev-parse", "--abbrev-ref", "HEAD"]);
run(["git", "push", "origin", `HEAD:${branch}`, `v${released}`]);

const url = `https://www.npmjs.com/package/${name}/v/${released}`;
summary(`### 📦 Published \`${name}@${released}\`\n\n${url}`);
if (bootstrapToken) {
  summary(
    trustSetUp
      ? "Trusted publishing is set up. Now delete the NPM_TOKEN secret and the token on npmjs.com."
      : `Set up the trusted publisher on npmjs.com (${name} > Settings > Trusted publisher: ${repo}, release.yml), then delete the NPM_TOKEN secret and the token.`
  );
}
console.log(`\n✓ published ${name}@${released}`);
