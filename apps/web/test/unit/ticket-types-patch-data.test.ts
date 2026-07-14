import { describe, expect, it } from "vitest";
import { computeTicketTypePatchData } from "../../src/admin/ticket-types-routes.js";

describe("computeTicketTypePatchData", () => {
  it("omits label from the update when it matches what was already read (TOCTOU fix, CodeRabbit review)", () => {
    // This is the exact shape a same-label, color-only PATCH produces. If label were included
    // here anyway, the handler's transaction would write it unconditionally - silently reverting
    // a concurrent rename that landed between the handler's `existing` read and its own write,
    // since this path never takes the rename lock.
    const data = computeTicketTypePatchData({ label: "VIP", color: "blue" }, "VIP");
    expect(data).toEqual({ color: "blue" });
    expect(data.label).toBeUndefined();
  });

  it("includes label when it genuinely differs from what was read", () => {
    const data = computeTicketTypePatchData({ label: "VIP Gold" }, "VIP");
    expect(data).toEqual({ label: "VIP Gold" });
  });

  it("includes color-only changes with no label field at all", () => {
    const data = computeTicketTypePatchData({ color: "red" }, "VIP");
    expect(data).toEqual({ color: "red" });
  });

  it("returns an empty object for a genuine no-op patch (both fields absent)", () => {
    const data = computeTicketTypePatchData({}, "VIP");
    expect(data).toEqual({});
  });
});
