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
      "This event has 1 issued wallet pass. Clearing the API key stops syncing, voiding, restoring, and pushing updates to it until a working key is set again.",
    );
  });

  it("uses plural wording for more than one issued pass", () => {
    expect(describeWalletKeyClearConfirm(4)).toBe(
      "This event has 4 issued wallet passes. Clearing the API key stops syncing, voiding, restoring, and pushing updates to them until a working key is set again.",
    );
  });
});

describe("describeWalletDisableConfirm", () => {
  it("uses singular wording for exactly one issued pass", () => {
    expect(describeWalletDisableConfirm(1)).toBe(
      "This event has 1 issued wallet pass. Turning off wallet passes stops syncing, voiding, restoring, and pushing updates to it, and any PassCreator update that arrives while it's off (a device registration, a removal) is dropped rather than queued - it won't be picked up once you turn this back on.",
    );
  });

  it("uses plural wording for more than one issued pass", () => {
    expect(describeWalletDisableConfirm(4)).toBe(
      "This event has 4 issued wallet passes. Turning off wallet passes stops syncing, voiding, restoring, and pushing updates to them, and any PassCreator update that arrives while it's off (a device registration, a removal) is dropped rather than queued - it won't be picked up once you turn this back on.",
    );
  });
});

describe("describeWalletPlatformDisableConfirm", () => {
  it("uses singular wording for one platform", () => {
    expect(describeWalletPlatformDisableConfirm(["apple"], { apple: 1, google: 0, samsung: 0 })).toBe(
      'Apple Wallet (1 installed pass) already has attendees who added it on their device. Turning this off hides the Add to Wallet button for anyone who hasn\'t added it yet, and the admin UI will show already-installed passes as "not added" until you turn it back on - nothing changes on attendees\' actual devices.',
    );
  });

  it("uses plural wording for one platform with more than one installed pass", () => {
    expect(describeWalletPlatformDisableConfirm(["samsung"], { apple: 0, google: 0, samsung: 3 })).toBe(
      'Samsung Wallet (3 installed passes) already has attendees who added it on their device. Turning this off hides the Add to Wallet button for anyone who hasn\'t added it yet, and the admin UI will show already-installed passes as "not added" until you turn it back on - nothing changes on attendees\' actual devices.',
    );
  });

  it("joins and pluralizes for more than one platform", () => {
    expect(
      describeWalletPlatformDisableConfirm(["apple", "google"], { apple: 2, google: 5, samsung: 0 }),
    ).toBe(
      'Apple Wallet (2 installed passes) and Google Wallet (5 installed passes) already have attendees who added them on their device. Turning these off hides the Add to Wallet button for anyone who hasn\'t added it yet, and the admin UI will show already-installed passes as "not added" until you turn them back on - nothing changes on attendees\' actual devices.',
    );
  });
});
