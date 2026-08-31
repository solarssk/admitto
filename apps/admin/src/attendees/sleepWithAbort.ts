/** Shared by every poller in this directory (pollWalletPushCompletion, pollWalletRefreshStatusCompletion)
 * - previously each kept its own byte-identical copy, which tripped SonarCloud's new-code
 * duplication gate once a third one existed (AGENTS.md's "new AdminJob drain file mirroring an
 * existing sibling" gotcha applies here too, just on the frontend side). Plain setTimeout, not
 * the shared lib/sleep-with-abort.js (window.setTimeout) - needs to run under a plain Node test
 * environment (vi.useFakeTimers()), where `window` doesn't exist at all. */
export function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

export function sleepWithAbort(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.reject(new DOMException("Aborted", "AbortError"));
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
