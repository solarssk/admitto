import { defineConfig } from "vitest/config";

/**
 * Root-level aggregator so `npx vitest run` from the repo root resolves into every package's own
 * vitest config — including its own DATABASE_URL override to the package's `*_test` database —
 * instead of falling through to whatever DATABASE_URL happens to be ambient (a real dev database,
 * e.g. a shell that has sourced packages/db/.env directly - Prisma Client itself no longer
 * auto-loads that file as a side effect of construction; that v5/v6 behavior was removed in v7).
 * `npm test` (`--workspaces`) was never affected by this — each workspace's own `npm run test`
 * already `cd`s into that package first.
 *
 * Only works from the repo root. `test.projects` entries below are resolved relative to CWD, not
 * to this file's own directory — running `npx vitest run` from any OTHER directory fails at
 * startup ("references a non-existing file") rather than silently using the wrong config. That's
 * an acceptable failure mode (loud crash, not a silent DB leak), just not "works from anywhere" -
 * don't claim that in future edits without re-verifying it (independently checked 2026-07-19: it
 * does not).
 *
 * Every entry below is a LEAF config (one that sets `test.env`/`test.setupFiles` directly), not
 * a delegating one. `apps/web/vitest.config.ts` and `packages/auth/vitest.config.ts` themselves
 * use `test.projects` to fan out to their own `vitest.unit.config.ts`/`vitest.integration.config.ts`
 * - referencing the delegating file here instead of its leaves silently dropped that nested
 * `projects` expansion in a full (unscoped) run and let those two packages' tests fall through to
 * an ambient DATABASE_URL (2026-07-18 incident - do not reintroduce this by "simplifying" back to
 * a glob or to the two packages' own top-level vitest.config.ts).
 *
 * Every entry is a plain string path - NOT the `[path, { test: {...} }]` tuple form. That form
 * looked like "load this file, then override its name" and was used in an earlier version of this
 * file to rename the two colliding "unit" projects (packages/auth and apps/web both name their
 * own unit project "unit" standalone). It does not do that: per Vitest's own resolveTestProjectConfigs
 * (node_modules/vitest/dist/chunks/cli-api.*.js), only `typeof definition === "string"` gets
 * treated as "resolve this config file" - anything else (including a 2-element array) falls into
 * the final `else` branch and is pushed as an INLINE project config object as-is. An array has no
 * `.test`/`.root`/`.configFile` properties, so Vitest silently created an unconfigured project
 * rooted at the repo root with its own default `include` glob - which matches every test file in
 * the entire monorepo, including a stale prior build's compiled `dist/test/*.test.js` (this root
 * config's own `exclude` does not apply to it either, since it's a separate inline project, not a
 * child of this one). Confirmed via an independent review 2026-07-19 and by reading the Vitest
 * source directly - this was NOT "Vitest auto-discovers workspace dependencies as ghost projects"
 * as an earlier version of this comment claimed; it was this file's own invalid tuple syntax.
 * Fixed by renaming the two projects' `test.name` directly in their own leaf config files instead
 * (`apps/web/vitest.unit.config.ts` → "web-unit", `packages/auth/vitest.unit.config.ts` →
 * "auth-unit") and listing every entry here as a plain string.
 *
 * `env.DATABASE_URL` below is deliberately an invalid host, kept as a defense-in-depth backstop
 * even after the tuple bug fix above: if any project - through this bug, a future Vitest version
 * change, or something not yet discovered - ends up not correctly inheriting its own leaf's
 * DATABASE_URL override, it inherits this poisoned one instead of the real ambient database. A
 * connection to it fails immediately (ECONNREFUSED), and separately, because the poisoned database
 * name doesn't end in `_test`, packages/db/src/testDbGuard.ts's assertTestDatabaseUrl (PR #518)
 * rejects it too for any code path that calls that guard. This does NOT poison other ambient
 * secrets a ghost/misconfigured project might still read (SMTP settings, encryption keys, etc.) -
 * only DATABASE_URL is covered. Verified empirically, not by inspection: renamed the real dev
 * database out of the way (ALTER DATABASE ... RENAME) before full root-level runs, confirmed zero
 * references to it in the output across multiple runs, then renamed it back.
 *
 * No `sequence.concurrent` here. An earlier commit on this branch set `sequence: { concurrent:
 * false }` at this level believing it serializes sibling projects - it does not. That option only
 * controls whether tests WITHIN one file run concurrently, `false` is already Vitest's default,
 * and workers read the root-level value anyway (per-project `sequence.concurrent` is ignored -
 * see serializeConfig in node_modules/vitest/dist/chunks/cli-api.*.js). What actually keeps the
 * DB-touching projects from overlapping: each of them sets `fileParallelism: false` (which
 * resolveConfig normalizes to `maxWorkers: 1`), and the scheduler (groupSpecs, same chunk) puts
 * every file of a `maxWorkers: 1` + `isolate: true` project into one shared sequential group that
 * runs one file at a time, after all other projects have finished behind a barrier. Their
 * globalSetups likewise all run sequentially before any test file starts. The intermittent
 * identity-api-routes failure that commit tried to fix was therefore never a concurrency race -
 * it was cf-access-routes.test.ts leaving CF Access rows behind in the shared SystemSettings
 * table, fixed where it belongs (that file's afterAll + a defensive clear in the affected test).
 */
export default defineConfig({
  test: {
    env: {
      DATABASE_URL: "postgresql://intentionally-invalid-root-fallback@127.0.0.1:1/refuse-to-run",
    },
    exclude: ["**/node_modules/**", "**/dist/**"],
    projects: [
      "packages/db/vitest.config.ts",
      "packages/tickets/vitest.config.ts",
      "packages/import/vitest.config.ts",
      "packages/mail-delivery/vitest.config.ts",
      "packages/mailer-config/vitest.config.ts",
      "packages/mail-templates/vitest.config.ts",
      "packages/crypto/vitest.config.ts",
      "packages/mailer/vitest.config.ts",
      "packages/shared/vitest.config.ts",
      "packages/ui/vitest.config.ts",
      "packages/auth/vitest.unit.config.ts",
      "packages/auth/vitest.integration.config.ts",
      "apps/web/vitest.unit.config.ts",
      "apps/web/vitest.integration.config.ts",
      "apps/admin/vitest.config.ts",
      "apps/cli/vitest.config.ts",
    ],
  },
});
