import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { vitestCoverage } from "../../vitest.coverage.ts";
import { resolveAppVersion, resolveCommitSha } from "./build-meta.ts";

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(resolveAppVersion()),
    __APP_COMMIT__: JSON.stringify(resolveCommitSha()),
  },
  test: {
    coverage: vitestCoverage,
    environment: "node",
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
    // Vitest's default thread count is `os.availableParallelism() - 1`. With 264 files each
    // spinning up its own jsdom environment plus React rendering, running that many concurrent
    // worker threads saturates the machine and starves individual tests of CPU time - `waitFor`/
    // `findBy*` calls that normally resolve in milliseconds intermittently blow past the 5s test
    // timeout under that contention (never an assertion failure, and every flagged file passes
    // reliably in isolation). Capping concurrency leaves the run CPU-bound instead of
    // context-switch-bound. testTimeout is also raised as a second line of defense for
    // legitimately slower CI hardware, not to mask this.
    maxWorkers: 4,
    testTimeout: 10_000,
    // Newer Node ships a webstorage global localStorage that (a) emits an
    // ExperimentalWarning on any access and (b) shadows jsdom's working
    // localStorage, because vitest skips window keys that already exist on
    // globalThis (vitest-dev/vitest#8757). Disabling webstorage in test
    // workers restores the intended semantics: jsdom files get jsdom's real
    // localStorage, node files get none. Conditional because older Node
    // (e.g. 24 on CI) neither defines the global nor accepts the flag —
    // passing it there crashes every worker with "bad option". The `in`
    // check does not invoke the getter, so it cannot itself warn.
    execArgv: "localStorage" in globalThis ? ["--no-webstorage"] : [],
  },
});
