import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { withPinnedFetch } from "../src/pinnedFetch.js";

/**
 * Exercises withPinnedFetch against a real local HTTP server with real undici —
 * unlike powerAutomate.test.ts (which mocks undici), this is the only place that
 * would catch a real Agent/dispatcher lifecycle bug: dispatcher.close() waits for
 * the request to fully complete, which for an unread response body means it waits
 * forever. Regression test for that deadlock (caught via a real 20MB response
 * during review — a small body drains fast enough to mask the bug).
 */
describe("withPinnedFetch (real undici, real socket)", () => {
  let server: Server;
  let port: number;

  function listen(body: string): Promise<void> {
    server = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end(body);
    });
    return new Promise((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        port = (server.address() as { port: number }).port;
        resolve();
      });
    });
  }

  afterEach(() => {
    server?.close();
  });

  it("resolves promptly for a large response when the handler consumes the body", async () => {
    await listen("x".repeat(5 * 1024 * 1024)); // 5MB — large enough that an unread body would hang dispatcher.close()
    const url = `http://127.0.0.1:${port}/`;

    const result = await withPinnedFetch(
      url,
      "127.0.0.1",
      [{ address: "127.0.0.1", family: 4 }],
      { method: "POST", headers: {}, body: "{}" },
      async (res) => ({ ok: res.ok, length: (await res.text()).length }),
    );

    expect(result).toEqual({ ok: true, length: 5 * 1024 * 1024 });
  }, 10_000);
});
