import { describe, expect, it, vi } from "vitest";
import {
  MAX_WEATHER_RESPONSE_BYTES,
  readJsonCapped,
} from "../../src/weather/read-json-capped.js";
import { MetNoClient } from "../../src/weather/met-no-client.js";
import { OpenMeteoClient } from "../../src/weather/open-meteo-client.js";
import { defaultWeatherConfig } from "../../src/weather/config.js";

const encoder = new TextEncoder();

function streamOf(chunks: Uint8Array[], onCancel?: () => void): ReadableStream<Uint8Array> {
  let index = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[index++];
      if (chunk) controller.enqueue(chunk);
      else controller.close();
    },
    cancel() {
      onCancel?.();
    },
  });
}

/** Never ends on its own, so only the budget can stop the read. */
function endlessStream(chunk: () => Uint8Array, onCancel: () => void): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(chunk());
    },
    cancel() {
      onCancel();
    },
  });
}

describe("readJsonCapped", () => {
  it("parses a healthy body under the budget", async () => {
    const res = new Response(JSON.stringify({ ok: true }), { status: 200 });
    await expect(readJsonCapped(res, 64)).resolves.toEqual({ ok: true });
  });

  it("accepts a body of exactly the budget", async () => {
    const text = JSON.stringify({ a: "xxxx" });
    const res = new Response(text, { status: 200 });
    await expect(readJsonCapped(res, encoder.encode(text).byteLength)).resolves.toEqual({
      a: "xxxx",
    });
  });

  it("rejects an oversize declared Content-Length and cancels the stream", async () => {
    const cancel = vi.fn();
    const res = new Response(streamOf([encoder.encode("{}")], cancel), {
      status: 200,
      headers: { "content-length": "65" },
    });
    await expect(readJsonCapped(res, 64)).rejects.toThrow("too large");
    expect(cancel).toHaveBeenCalled();
  });

  it("rejects a garbage Content-Length", async () => {
    const res = new Response("{}", { status: 200, headers: { "content-length": "abc" } });
    await expect(readJsonCapped(res, 64)).rejects.toThrow("too large");
  });

  it("counts decoded bytes across two chunks when Content-Length is missing or lies", async () => {
    const cancel = vi.fn();
    const chunk = () => encoder.encode('{"a":"' + "x".repeat(20));
    const res = new Response(streamOf([chunk(), chunk(), encoder.encode('"}')], cancel), {
      status: 200,
      headers: { "content-length": "5" },
    });
    await expect(readJsonCapped(res, 32)).rejects.toThrow("too large");
    expect(cancel).toHaveBeenCalled();
  });

  it("rejects malformed JSON and a missing body", async () => {
    await expect(readJsonCapped(new Response("{nope", { status: 200 }), 64)).rejects.toThrow();
    await expect(readJsonCapped(new Response(null, { status: 200 }), 64)).rejects.toThrow(
      "no body",
    );
  });

  it("propagates a stream error", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error("socket reset"));
      },
    });
    await expect(readJsonCapped(new Response(body, { status: 200 }), 64)).rejects.toThrow(
      "socket reset",
    );
  });

  it("uses a finite default well above a real forecast", () => {
    expect(MAX_WEATHER_RESPONSE_BYTES).toBe(1_000_000);
  });
});

describe("weather clients over the body budget", () => {
  // A fresh array per chunk: a stream may detach a buffer it has already handed on.
  const big = () => encoder.encode("x".repeat(600_000));

  it("OpenMeteoClient answers a fixed unavailable error for a chunked oversize body", async () => {
    const cancel = vi.fn();
    const client = new OpenMeteoClient({
      config: defaultWeatherConfig(),
      fetchFn: (async () =>
        new Response(endlessStream(big, cancel), { status: 200 })) as unknown as typeof fetch,
    });
    await expect(client.fetchDayForecast(52.5, 13.4, "2026-08-10")).rejects.toMatchObject({
      kind: "unavailable",
    });
    expect(cancel).toHaveBeenCalled();
  });

  it("MetNoClient answers a fixed unavailable error for a declared oversize body", async () => {
    const client = new MetNoClient({
      timeoutMs: 5_000,
      userAgent: "Admitto/test",
      fetchFn: (async () =>
        new Response("{}", {
          status: 200,
          headers: { "content-length": "5000000" },
        })) as unknown as typeof fetch,
    });
    await expect(
      client.fetchDayForecast(59.91, 10.75, "2026-08-10", "UTC"),
    ).rejects.toMatchObject({ kind: "unavailable" });
  });

  it("MetNoClient answers unavailable for a chunked oversize body", async () => {
    const client = new MetNoClient({
      timeoutMs: 5_000,
      userAgent: "Admitto/test",
      fetchFn: (async () =>
        new Response(streamOf([big(), big()]), { status: 200 })) as unknown as typeof fetch,
    });
    await expect(
      client.fetchDayForecast(59.91, 10.75, "2026-08-10", "UTC"),
    ).rejects.toMatchObject({ kind: "unavailable" });
  });
});
