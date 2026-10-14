import { describe, expect, it } from "vitest";
import {
  SNAPSHOT_UNUSABLE_ERROR,
  snapshotUnusableUpdate,
  tryMaterializeStoredMessage,
} from "../src/snapshot-unusable.js";

const LINKS = {
  ticket_url: "https://tickets.example.com/t/abc",
  qr_image_url: "https://tickets.example.com/q/abc.png",
  apple_wallet_url: "",
  google_wallet_url: "",
};

describe("tryMaterializeStoredMessage", () => {
  it("fills the links into a healthy snapshot", () => {
    const out = tryMaterializeStoredMessage(
      { subject: "Your ticket", html: '<a href="{{ticket_url}}">Open</a>' },
      LINKS,
    );
    expect(out?.html).toContain('href="https://tickets.example.com/t/abc"');
  });

  it("returns null for a snapshot the renderer refuses instead of throwing", () => {
    expect(
      tryMaterializeStoredMessage({ subject: "Your ticket", html: "<a href={{ticket_url}}>Open</a>" }, LINKS),
    ).toBeNull();
  });
});

describe("snapshotUnusableUpdate", () => {
  it("is a failed, non-retryable row with the fixed error", () => {
    expect(snapshotUnusableUpdate()).toMatchObject({
      status: "failed",
      retryable: false,
      error: SNAPSHOT_UNUSABLE_ERROR,
      error_code: null,
    });
  });
});
