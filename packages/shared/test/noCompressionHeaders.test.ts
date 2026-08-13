import { describe, expect, it } from "vitest";
import { NO_COMPRESSION_HEADERS } from "../src/noCompressionHeaders.js";

describe("NO_COMPRESSION_HEADERS", () => {
  it("asks the server for an uncompressed response", () => {
    expect(NO_COMPRESSION_HEADERS).toEqual({ "Accept-Encoding": "identity" });
  });
});
