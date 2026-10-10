/**
 * Reads a response body chunk by chunk and stops as soon as it grows past `maxBytes`.
 * Shared by the geocoding and the map tile fetchers, which each turn the outcome into their own
 * error type. When the cap is passed the stream is cancelled, `tooLarge` is true and `total`
 * counts the bytes seen up to and including the chunk that crossed the cap. Read errors
 * propagate to the caller.
 */
export async function readChunksCapped(
  body: ReadableStream<Uint8Array>,
  maxBytes: number,
): Promise<{ chunks: Uint8Array[]; total: number; tooLarge: boolean }> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) return { chunks, total, tooLarge: false };
    if (!value || value.byteLength === 0) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return { chunks, total, tooLarge: true };
    }
    chunks.push(value);
  }
}
