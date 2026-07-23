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

  it("keeps unexpected non-error HTTP statuses terminal and non-retryable", () => {
    expect(mapHttpStatus(302)).toEqual({ status: "failed", retryable: false });
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

  it("reads responseCode when message has no SMTP code", () => {
    const err = new Error("Message failed") as Error & { responseCode: number };
    err.responseCode = 421;
    expect(mapSmtpError(err)).toEqual({ status: "failed", retryable: true });
  });

  it("reads response string when message has no SMTP code", () => {
    const err = new Error("Message failed") as Error & { response: string };
    err.response = "450 Mailbox unavailable";
    expect(mapSmtpError(err)).toEqual({ status: "failed", retryable: true });
  });

  it("prefers responseCode over message regex", () => {
    const err = new Error("535 auth disabled") as Error & { responseCode: number };
    err.responseCode = 421;
    expect(mapSmtpError(err)).toEqual({ status: "failed", retryable: true });
  });

  it("falls back to the error message when a structured response has no SMTP code", () => {
    const err = new Error("451 temporary mailbox failure") as Error & { response: string };
    err.response = "upstream temporarily unavailable";

    expect(mapSmtpError(err)).toEqual({ status: "failed", retryable: true });
  });

  it("maps unlisted transient 4xx (e.g. 454) to failed+retryable", () => {
    expect(mapSmtpError(new Error("454 TLS not available"))).toEqual({
      status: "failed",
      retryable: true,
    });
  });

  it("maps unlisted permanent 5xx (e.g. 554) to rejected+not retryable", () => {
    expect(mapSmtpError(new Error("554 Transaction failed"))).toEqual({
      status: "rejected",
      retryable: false,
    });
  });

  it("maps ECONNREFUSED to failed+retryable", () => {
    expect(mapSmtpError(new Error("connect ECONNREFUSED"))).toEqual({
      status: "failed",
      retryable: true,
    });
  });

  it("keeps unclassified transport errors terminal and non-retryable", () => {
    expect(mapSmtpError(new Error("unexpected transport response"))).toEqual({
      status: "failed",
      retryable: false,
    });
  });
});

describe("mapNetworkError", () => {
  it("returns failed+retryable", () => {
    expect(mapNetworkError()).toEqual({ status: "failed", retryable: true });
  });
});
