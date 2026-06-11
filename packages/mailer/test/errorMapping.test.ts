import { describe, expect, it } from "vitest";
import { mapHttpStatus, mapNetworkError, mapSmtpError } from "../src/errorMapping.js";

describe("mapHttpStatus", () => {
  it("maps 429 and 5xx to failed+retryable", () => {
    expect(mapHttpStatus(429)).toEqual({ status: "failed", retryable: true });
    expect(mapHttpStatus(503)).toEqual({ status: "failed", retryable: true });
  });

  it("maps 4xx (except 429) to rejected+not retryable", () => {
    expect(mapHttpStatus(403)).toEqual({ status: "rejected", retryable: false });
    expect(mapHttpStatus(401)).toEqual({ status: "rejected", retryable: false });
  });
});

describe("mapSmtpError", () => {
  it("maps 535 auth to rejected", () => {
    expect(mapSmtpError(new Error("535 auth disabled"))).toEqual({
      status: "rejected",
      retryable: false,
    });
  });

  it("maps transient 421 to failed+retryable", () => {
    expect(mapSmtpError(new Error("421 service not available"))).toEqual({
      status: "failed",
      retryable: true,
    });
  });

  it("maps ECONNREFUSED to failed+retryable", () => {
    expect(mapSmtpError(new Error("connect ECONNREFUSED"))).toEqual({
      status: "failed",
      retryable: true,
    });
  });
});

describe("mapNetworkError", () => {
  it("returns failed+retryable", () => {
    expect(mapNetworkError()).toEqual({ status: "failed", retryable: true });
  });
});
