// @vitest-environment jsdom
import { useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { useLoadingGate } from "../../src/hooks/useDelayedLoading.js";

/** Blocks the thread for `ms`, the way a slow render (coverage instrumentation, a weak phone) does. */
function block(ms: number): void {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    // busy
  }
}

function Probe({ loading, slowRenderMs, onState }: Readonly<{ loading: boolean; slowRenderMs: number; onState: (s: string) => void }>) {
  const { showIndicator, showContent } = useLoadingGate(loading);
  // The render that commits "loaded" is slow: its 200ms delay timer comes due while it is still running.
  if (!loading) block(slowRenderMs);
  useEffect(() => {
    onState(`${showIndicator ? "indicator" : "no-indicator"}/${showContent ? "content" : "no-content"}`);
  });
  return <span data-testid="state">{showContent ? "content" : "hidden"}</span>;
}

let root: Root | undefined;
afterEach(() => {
  root?.unmount();
  root = undefined;
  document.body.innerHTML = "";
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("useLoadingGate when the render that commits the loaded state is slow", () => {
  it("does not cover content that has already loaded with an indicator for a wait that is over", async () => {
    // Real timers, and outside act: the timing of effects is the point.
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
    const host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const seen: string[] = [];

    root.render(<Probe loading slowRenderMs={0} onState={(s) => seen.push(s)} />);
    await sleep(20);
    // The load finishes well inside the 200ms delay, but committing it takes 300ms of main-thread work.
    root.render(<Probe loading={false} slowRenderMs={300} onState={(s) => seen.push(s)} />);
    await sleep(800);

    expect(host.querySelector("[data-testid=state]")?.textContent).toBe("content");
    // Not even for a moment: the indicator must never have been raised for this finished wait.
    expect(seen.filter((s) => s.startsWith("indicator"))).toEqual([]);
  });
});
