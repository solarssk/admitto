import { readChunksCapped } from "../maps/read-capped-chunks.js";

/**
 * Upper bound on a decoded forecast body. A real Open-Meteo daily reply is a few KB and a MET
 * Norway compact reply well under 200 KB; this leaves headroom without letting a misbehaving
 * provider buffer an unbounded body into memory.
 */
export const MAX_WEATHER_RESPONSE_BYTES = 1_000_000;

/**
 * Parse a response body as JSON, reading it chunk by chunk and stopping once more than
 * `maxBytes` of decoded bytes have arrived. `Content-Length` is only an early hint: a chunked or
 * lying response is caught by the running count. Throws a plain `Error` (callers wrap it in their
 * own provider error), and cancels the stream on every over-budget path.
 */
export async function readJsonCapped(
  response: Response,
  maxBytes: number = MAX_WEATHER_RESPONSE_BYTES,
): Promise<unknown> {
  const declared = response.headers.get("content-length");
  if (declared != null) {
    const length = Number(declared);
    if (!Number.isFinite(length) || length < 0 || length > maxBytes) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error("weather response too large");
    }
  }
  if (!response.body) throw new Error("weather response has no body");

  const read = await readChunksCapped(response.body, maxBytes);
  if (read.tooLarge) throw new Error("weather response too large");

  const bytes = new Uint8Array(read.total);
  let offset = 0;
  for (const chunk of read.chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}
