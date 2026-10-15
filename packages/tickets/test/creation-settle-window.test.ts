import { describe, expect, it } from "vitest";
import { CREATE_PASS_DEADLINE_MS, PASSCREATOR_REQUEST_TIMEOUT_MS } from "@admitto/wallet";
import { ERASE_TRANSACTION_TIMEOUT_MS } from "../src/erase-attendees.js";
import { CREATION_SETTLE_WINDOW_MS } from "../src/erase-wallet-passes.js";

describe("CREATION_SETTLE_WINDOW_MS", () => {
  it("covers everything that can still be on its way after an erasure, with room left for the provider's own lag and for clocks", () => {
    // `erased_at` is the moment the erasure's transaction started, and the transaction can run for
    // ERASE_TRANSACTION_TIMEOUT_MS before it commits. A creation that passed its last check before the commit never
    // sends later than CREATE_PASS_DEADLINE_MS after that check, and its request ends within the client's timeout.
    // What is left of the window is the margin for the provider finishing a request that the client gave up on, for
    // the clocks of the hosts, and for the pacing gate: it has to stay at least five minutes, or "no pass under that id"
    // would be believed while a creation can still reach the provider.
    const worstCase = ERASE_TRANSACTION_TIMEOUT_MS + CREATE_PASS_DEADLINE_MS + PASSCREATOR_REQUEST_TIMEOUT_MS;
    expect(CREATION_SETTLE_WINDOW_MS - worstCase).toBeGreaterThanOrEqual(5 * 60_000);
  });
});
