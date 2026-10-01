import { describe, expect, it } from "vitest";
import {
  describeWalletDisableConfirm,
  describeWalletKeyClearConfirm,
  describeWalletPlatformDisableConfirm,
  describeWalletPushConfirm,
} from "../../src/utils/walletPushConfirm.js";

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
      "This event has 1 issued wallet pass. Clearing the API key stops syncing, voiding, restoring, and pushing updates to it.",
    );
  });

  it("uses plural wording for more than one issued pass", () => {
    expect(describeWalletKeyClearConfirm(4)).toBe(
      "This event has 4 issued wallet passes. Clearing the API key stops syncing, voiding, restoring, and pushing updates to them.",
    );
  });
});

describe("describeWalletDisableConfirm", () => {
  it("uses singular wording for exactly one issued pass", () => {
    expect(describeWalletDisableConfirm(1)).toBe(
      "This event has 1 issued wallet pass. Turning this off stops syncing, restoring, and pushing updates to it. You can still void, remove, or delete it, and PassCreator's own notifications keep being applied - only the periodic check pauses.",
    );
  });

  it("uses plural wording for more than one issued pass", () => {
    expect(describeWalletDisableConfirm(4)).toBe(
      "This event has 4 issued wallet passes. Turning this off stops syncing, restoring, and pushing updates to them. You can still void, remove, or delete them, and PassCreator's own notifications keep being applied - only the periodic check pauses.",
    );
  });
});

describe("describeWalletPlatformDisableConfirm", () => {
  it("uses singular wording for one platform", () => {
    expect(
      describeWalletPlatformDisableConfirm(["apple"], { apple: 1, google: 0, samsung: 0 }, false, 1),
    ).toBe(
      "Apple Wallet (1 installed pass) already has attendees using it. Turning this off hides the Add to Wallet button for new attendees, and hides existing status from the Attendees list until you turn it back on. Nothing changes on attendees' actual devices.",
    );
  });

  it("uses plural wording for one platform with more than one installed pass", () => {
    expect(
      describeWalletPlatformDisableConfirm(["samsung"], { apple: 0, google: 0, samsung: 3 }, false, 3),
    ).toBe(
      "Samsung Wallet (3 installed passes) already has attendees using it. Turning this off hides the Add to Wallet button for new attendees, and hides existing status from the Attendees list until you turn it back on. Nothing changes on attendees' actual devices.",
    );
  });

  it("joins and pluralizes for more than one platform", () => {
    expect(
      describeWalletPlatformDisableConfirm(["apple", "google"], { apple: 2, google: 5, samsung: 0 }, false, 7),
    ).toBe(
      "Apple Wallet (2 installed passes) and Google Wallet (5 installed passes) already have attendees using them. Turning these off hides the Add to Wallet button for new attendees, and hides existing status from the Attendees list until you turn them back on. Nothing changes on attendees' actual devices.",
    );
  });

  // Regression (CodeRabbit review): wallet_apple_enabled's own relevantDate side effect can queue
  // an event-wide push in the same save that disables it - the message must not claim nothing
  // changes on devices when something, in fact, will.
  it("mentions the event-wide push instead of claiming nothing changes on devices, when alsoPushes is true", () => {
    expect(
      describeWalletPlatformDisableConfirm(["apple"], { apple: 2, google: 0, samsung: 0 }, true, 6),
    ).toBe(
      "Apple Wallet (2 installed passes) already has attendees using it. Turning this off hides the Add to Wallet button for new attendees, and hides existing status from the Attendees list until you turn it back on. This save will also push an update to 6 installed wallet passes across every platform.",
    );
  });
});
