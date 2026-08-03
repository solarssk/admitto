import { beforeEach, describe, expect, it, vi } from "vitest";
import { lookup } from "node:dns/promises";
import { probeMailTransport } from "../src/probe.js";
import type { FetchFn } from "../src/types.js";

vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(),
}));

const mockedLookup = vi.mocked(lookup);

beforeEach(() => {
  mockedLookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }] as Awaited<
    ReturnType<typeof lookup>
  >);
});

describe("probeMailTransport", () => {
  it("probes Graph by fetching a client-credentials token", async () => {
    const fetchFn = vi.fn(async () =>
      Response.json({ access_token: "tok", expires_in: 3600 }),
    ) as unknown as FetchFn;

    const result = await probeMailTransport(
      {
        provider: "graph",
        mailbox: "mail@example.com",
        tenantId: "tenant",
        clientId: "client",
        clientSecret: "secret",
      },
      { fetchFn },
    );

    expect(result).toEqual({ ok: true });
    expect(fetchFn).toHaveBeenCalled();
  });

  it("returns ok:false when Graph token fetch fails", async () => {
    const fetchFn = vi.fn(async () =>
      Response.json({ error: "invalid_client", error_description: "bad secret" }, { status: 401 }),
    ) as unknown as FetchFn;

    const result = await probeMailTransport(
      {
        provider: "graph",
        mailbox: "mail@example.com",
        tenantId: "tenant",
        clientId: "client",
        clientSecret: "secret",
      },
      { fetchFn },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/Graph token error/i);
      expect(result.error).not.toContain("bad secret");
    }
  });

  it("skips live verify for Power Automate after create succeeds", async () => {
    const result = await probeMailTransport({
      provider: "powerautomate",
      url: "https://prod.example.com/workflows/hook",
      fromAddress: "from@example.com",
    });

    expect(result).toEqual({ ok: true, skipped: true });
  });

  it("returns ok:false when createMailer rejects (invalid config)", async () => {
    const result = await probeMailTransport({ provider: "smtp" });
    expect(result.ok).toBe(false);
  });
});
