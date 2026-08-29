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
    // AttendeeDetailPage.*.test.tsx's org-admin variant files share one project so they can
    // load attendeeDetailPageSetup.ts via `setupFiles` - the vi.mock() calls it contains
    // (attendeeDetailForm.js, AuthProvider.js, react-router) were byte-for-byte identical
    // across these files. A plain side-effect `import "./attendeeDetailPageSetup.js"` from
    // inside a test file does NOT work here: vi.mock hoisting is a per-file static-analysis
    // transform that only sees mock calls written directly in that file's own source -
    // `setupFiles` is Vitest's actual supported mechanism for sharing mock registration across
    // files (confirmed working). archived.test.tsx keeps its own local `vi.mock("react-router",
    // ...)` on top of the shared setup - it needs `archived_at` set on the event, unlike every
    // sibling file - a later, file-local vi.mock() call for a path also registered in
    // `setupFiles` wins over the setupFile's version (also confirmed working, not assumed).
    // The remaining AttendeeDetailPage test files genuinely differ in more than that one field
    // and correctly keep all their own local mocks, not included here: errors/notes/revokePass
    // need a superadmin (or per-test-mutable) assignment, walletActions needs extra
    // wallet-specific outlet-context fields on top of a different assignment too.
    // AttendeesPage.{sort,mailStatusFilter,pageSize,search}.test.tsx are byte-for-byte
    // identical (bar one file's extra `act` import) from the top of the file through
    // renderPage() - same shared-setup treatment as the AttendeeDetailPage project above.
    // AttendeesPage's other 6 *.test.tsx files (archived, bulkSelection, exportAndSend,
    // exportMenu, load, mailGate) each genuinely diverge somewhere in that span and correctly
    // keep their own local setup, not included here.
    projects: [
      {
        extends: true,
        test: {
          name: "attendee-detail-page-shared-setup",
          include: [
            "test/attendees/AttendeeDetailPage.{statusTones,resend,profileEdit,mailGate,deleteAttendee,revokeCheckIn,copyTicketLink,archived}.test.tsx",
          ],
          setupFiles: ["./test/attendees/attendeeDetailPageSetup.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "attendees-page-shared-setup",
          include: ["test/attendees/AttendeesPage.{sort,mailStatusFilter,pageSize,search}.test.tsx"],
          setupFiles: ["./test/attendees/attendeesPageSetup.tsx"],
        },
      },
      {
        extends: true,
        test: {
          name: "default",
          include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
          exclude: [
            "test/attendees/AttendeeDetailPage.{statusTones,resend,profileEdit,mailGate,deleteAttendee,revokeCheckIn,copyTicketLink,archived}.test.tsx",
            "test/attendees/AttendeesPage.{sort,mailStatusFilter,pageSize,search}.test.tsx",
          ],
        },
      },
    ],
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
