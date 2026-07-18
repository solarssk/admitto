import { defineConfig } from "vitest/config";

/**
 * Root-level aggregator so `npx vitest run` from the repo root (or any directory, via an IDE or
 * a stray command) resolves into every package's own vitest config — including its own
 * DATABASE_URL override to the package's `*_test` database — instead of falling through to
 * whatever DATABASE_URL happens to be ambient (a real dev database via Prisma's own dotenv
 * auto-load). `npm test` (`--workspaces`) was never affected by this — each workspace's own
 * `npm run test` already `cd`s into that package first.
 *
 * Every entry below is a LEAF config (one that sets `test.env`/`test.setupFiles` directly), not
 * a delegating one. `apps/web/vitest.config.ts` and `packages/auth/vitest.config.ts` themselves
 * use `test.projects` to fan out to their own `vitest.unit.config.ts`/`vitest.integration.config.ts`
 * - referencing the delegating file here instead of its leaves silently dropped that nested
 * `projects` expansion in a full (unscoped) run and let those two packages' tests fall through to
 * an ambient DATABASE_URL (2026-07-18 incident - do not reintroduce this by "simplifying" back to
 * a glob or to the two packages' own top-level vitest.config.ts).
 *
 * KNOWN ISSUE (2026-07-18, not yet root-caused): Vitest 4.1.9 appears to spawn extra, unnamed
 * "ghost" projects for a listed project's own workspace *dependencies* (e.g. listing
 * packages/auth - which depends on @admitto/crypto - also runs packages/crypto's tests a second
 * time, unnamed, without packages/crypto's own env overrides). Not documented in Vitest's guide
 * (checked https://vitest.dev/guide/projects); may be an undocumented Vite workspace-resolution
 * behavior or a genuine Vitest bug. Root-caused far enough to confirm it does NOT depend on this
 * file's own `projects` entries (it still happens with an empty-ish list) - not far enough to
 * eliminate outright tonight. Mitigated below instead of solved: `env.DATABASE_URL` at THIS root
 * level is deliberately an invalid host, so any ghost project that doesn't correctly inherit its
 * real leaf's env override gets a hard connection-refused failure instead of a silently-ambient
 * DATABASE_URL. Each leaf's own `env.DATABASE_URL` still overrides this for its OWN, correctly-run
 * copy - this is the actual safety property this file exists for, and it holds regardless of the
 * ghost-project noise. The ghost-run test-count/failure noise itself is a follow-up to fix or
 * upgrade Vitest to resolve, not a safety issue - do not treat "some project count looks
 * inflated" as a regression in this file without first checking whether the *real* leaf project
 * for that package still resolves the correct database (it does, as of this commit - verified via
 * temporarily renaming the real dev database out of the way and confirming a full root-level run
 * never references it).
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
      "packages/ui/vitest.config.ts",
      ["packages/auth/vitest.unit.config.ts", { test: { name: "auth-unit" } }],
      "packages/auth/vitest.integration.config.ts",
      ["apps/web/vitest.unit.config.ts", { test: { name: "web-unit" } }],
      "apps/web/vitest.integration.config.ts",
      "apps/admin/vitest.config.ts",
      "apps/cli/vitest.config.ts",
    ],
  },
});
