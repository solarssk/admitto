import { defineConfig } from "vitest/config";
import { vitestCoverage } from "../../vitest.coverage.ts";

export default defineConfig({
  test: {
    coverage: vitestCoverage,
    projects: ["./vitest.unit.config.ts", "./vitest.integration.config.ts"],
    // No root-level maxWorkers/fileParallelism override here (there used to be one, forcing
    // maxWorkers: 1 / fileParallelism: false for both projects combined) - each project below now
    // owns its own concurrency: web-unit runs fully parallel (real Prisma-client-construction race
    // removed, see that config's own comment), integration also runs fully parallel now (each
    // Vitest fork worker gets its own Postgres schema - see provisionWorkerSchemas.ts - so no two
    // files can collide on shared tables regardless of what runs concurrently). Confirmed
    // empirically that a project's own maxWorkers/pool settings are honored even when resolved
    // through this root aggregator - Vitest's docs don't spell out this precedence for the
    // "projects" feature, so don't assume it without re-checking if this file changes again.
    //
    // onUnhandledError is a root-only option (Vitest silently ignores it set on a project config)
    // - suppresses one specific, known-harmless Vitest bug: `pool: "forks"` worker teardown racing
    // an in-flight console.log RPC call, surfaced once in CI at web-unit's maxWorkers: 4 (not
    // reproduced in 27 local repeat runs, only once on the CI runner). Tracked upstream, open on
    // the latest Vitest 5.0.0 as vitest-dev/vitest#11153 (opened 2026-09-04, reproduces on both
    // v4.1.11 and v5.0.0, maxWorkers:1 does not help - three earlier issues this comment used to
    // cite, #8649/#9872/#9736, are unrelated/already closed; #11153 is the one that actually
    // matches this exact message). It fails the whole run as an "unhandled error" even though
    // every actual test passes (confirmed: 3541/3541 passed in the run that hit it) - Vitest's own
    // docs name `onUnhandledError` (not disabling `trackUnhandledErrors` globally) as the intended
    // way to hide one specific known error without also hiding genuinely new ones. Matches only
    // this exact message text, not error type/name, so an unrelated real EnvironmentTeardownError
    // (a different message) still fails the run as normal - verified by throwing both messages
    // from a scratch test and confirming only the matching one changes the exit code (0 vs the
    // correct 1), then deleting that scratch test.
    // TODO: once vitest-dev/vitest#11153 is closed, bump Vitest and check whether this is still
    // reproducible before removing the suppression.
    onUnhandledError(error) {
      if (error.message?.includes('Closing rpc while "onUserConsoleLog" was pending')) return false;
    },
  },
});
