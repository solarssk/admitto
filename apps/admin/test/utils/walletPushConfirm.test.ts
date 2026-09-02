import { describe, expect, it } from "vitest";
import { describeWalletKeyClearConfirm, describeWalletPushConfirm } from "../../src/utils/walletPushConfirm.js";

describe("describeWalletPushConfirm", () => {
  it("uses singular wording for exactly one installed pass", () => {
    expect(describeWalletPushConfirm(1)).toBe(
      "This will push the update to 1 attendee's installed wallet pass.",
    );
  });

  it("uses plural wording for more than one installed pass", () => {
    expect(describeWalletPushConfirm(3)).toBe(
      "This will push the update to 3 attendees' installed wallet passes.",
    );
  });
});

describe("describeWalletKeyClearConfirm", () => {
  it("uses singular wording for exactly one issued pass", () => {
    expect(describeWalletKeyClearConfirm(1)).toBe(
      "This event has 1 issued wallet pass. Clearing the API key stops syncing, voiding, restoring, and pushing updates to it until a working key is set again.",
    );
  });

  it("uses plural wording for more than one issued pass", () => {
    expect(describeWalletKeyClearConfirm(4)).toBe(
      "This event has 4 issued wallet passes. Clearing the API key stops syncing, voiding, restoring, and pushing updates to them until a working key is set again.",
    );
  });
});
