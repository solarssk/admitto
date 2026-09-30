// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { enableDeferredStylesheets } from "../../src/utils/deferred-styles.js";
import { LOAD_TIMEOUT_MS } from "../../src/utils/loading-timing.js";

function addLink(href: string, { loaded = false }: { loaded?: boolean } = {}): HTMLLinkElement {
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  link.media = "print";
  link.setAttribute("data-deferred-css", "");
  // jsdom loads no stylesheets: `sheet` is what a loaded one has.
  if (loaded) Object.defineProperty(link, "sheet", { value: {} });
  document.head.appendChild(link);
  return link;
}

/** True once `promise` has settled, without waiting for it. */
async function settled(promise: Promise<void>): Promise<boolean> {
  let done = false;
  void promise.then(() => {
    done = true;
  });
  await Promise.resolve();
  await Promise.resolve();
  return done;
}

afterEach(() => {
  document.head.innerHTML = "";
  vi.useRealTimers();
});

describe("enableDeferredStylesheets", () => {
  it("resolves at once when the page has nothing deferred (dev server)", async () => {
    await expect(enableDeferredStylesheets()).resolves.toBeUndefined();
  });

  it("switches a stylesheet on when it has loaded, and not before", async () => {
    const link = addLink("/a.css");
    const ready = enableDeferredStylesheets();
    expect(await settled(ready)).toBe(false);
    expect(link.media).toBe("print");

    link.dispatchEvent(new Event("load"));
    await ready;
    expect(link.media).toBe("all");
  });

  it("switches on one that had already loaded before it was asked", async () => {
    const link = addLink("/a.css", { loaded: true });
    await enableDeferredStylesheets();
    expect(link.media).toBe("all");
  });

  it("waits for every deferred stylesheet", async () => {
    const first = addLink("/a.css");
    const second = addLink("/b.css");
    const ready = enableDeferredStylesheets();

    first.dispatchEvent(new Event("load"));
    expect(await settled(ready)).toBe(false);
    expect(first.media).toBe("all");
    expect(second.media).toBe("print");

    second.dispatchEvent(new Event("load"));
    await ready;
    expect(second.media).toBe("all");
  });

  it("switches a stylesheet that failed to load on anyway, so the app still starts", async () => {
    const link = addLink("/missing.css");
    const ready = enableDeferredStylesheets();
    link.dispatchEvent(new Event("error"));
    await ready;
    expect(link.media).toBe("all");
  });

  it("gives up waiting for one that never answers after the load timeout", async () => {
    vi.useFakeTimers();
    const link = addLink("/stalled.css");
    const ready = enableDeferredStylesheets();
    await vi.advanceTimersByTimeAsync(LOAD_TIMEOUT_MS - 1);
    expect(link.media).toBe("print");
    await vi.advanceTimersByTimeAsync(1);
    await ready;
    expect(link.media).toBe("all");
  });

  it("leaves a stylesheet that was never deferred alone", async () => {
    const plain = document.createElement("link");
    plain.rel = "stylesheet";
    plain.href = "/plain.css";
    document.head.appendChild(plain);
    await enableDeferredStylesheets();
    expect(plain.media).toBe("");
  });
});
