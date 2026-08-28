import type { Context } from "hono";
import { describe, expect, it } from "vitest";
import { transportTestResponse } from "../../src/admin/mail-settings-shared.js";

function fakeContext(): Context {
  return {
    json: (data: unknown, status?: number) =>
      new Response(JSON.stringify(data), {
        status: status ?? 200,
        headers: { "content-type": "application/json" },
      }),
  } as unknown as Context;
}

describe("transportTestResponse", () => {
  it("falls back to the generic send-failed message when the outcome carries no errorMessage", async () => {
    const res = transportTestResponse(fakeContext(), { resultStatus: "failed" });

    expect(await res.json()).toEqual({ status: "failed", error: "Send failed." });
  });

  it("uses the outcome's own errorMessage when one is present", async () => {
    const res = transportTestResponse(fakeContext(), {
      resultStatus: "failed",
      errorMessage: "Mailbox does not exist",
    });

    expect(await res.json()).toEqual({ status: "failed", error: "Mailbox does not exist" });
  });
});
