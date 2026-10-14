import { describe, expect, it } from "vitest";
import { CREATE_PASS_DEADLINE_MS } from "@admitto/wallet";
import { CREATION_SETTLE_WINDOW_MS } from "../src/erase-wallet-passes.js";

describe("CREATION_SETTLE_WINDOW_MS", () => {
  it("stays several times longer than a pass creation can take after it started", () => {
    // A creation never sends its request later than CREATE_PASS_DEADLINE_MS after it was called, the request itself
    // ends within the client's 15 s timeout, and the provider's own lag is seconds. The window has to stay a multiple
    // of that: otherwise "no pass under that id" would be believed while a creation can still reach the provider,
    // and nothing would ever delete that pass.
    expect(CREATION_SETTLE_WINDOW_MS).toBeGreaterThanOrEqual(4 * CREATE_PASS_DEADLINE_MS);
  });
});
