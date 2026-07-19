import { describe, expect, it, vi } from "vitest";
import { ExportOnlyAdapter } from "../src/adapters/exportOnly.js";
import { createMailer } from "../src/index.js";

describe("ExportOnlyAdapter", () => {
  it("returns accepted without sending and invokes exportSink", async () => {
    const sink = vi.fn();
    const adapter = new ExportOnlyAdapter(
      { provider: "export_only", fromAddress: "events@example.com", fromName: "Events" },
      sink,
    );

    const message = { to: "jan@example.com", subject: "Hi", html: "<p>x</p>", idempotencyKey: "k1" };
    const res = await adapter.send(message);

    expect(res.status).toBe("accepted");
    expect(res.provider).toBe("export_only");
    expect(res.idempotencyKey).toBe("k1");
    expect(sink).toHaveBeenCalledWith({
      message,
      sender: { fromAddress: "events@example.com", fromName: "Events" },
    });
  });

  it("returns failed when exportSink throws (sync)", async () => {
    const adapter = new ExportOnlyAdapter(
      { provider: "export_only", fromAddress: "events@example.com" },
      () => {
        throw new Error("disk full");
      },
    );
    const res = await adapter.send({ to: "a@example.com", subject: "S", html: "<p>x</p>" });
    expect(res.status).toBe("failed");
    expect(res.retryable).toBe(false);
    expect(res.error).toContain("disk full");
  });

  it("returns failed when exportSink rejects (async)", async () => {
    const adapter = new ExportOnlyAdapter(
      { provider: "export_only", fromAddress: "events@example.com" },
      async () => {
        throw new Error("write timeout");
      },
    );
    const res = await adapter.send({ to: "a@example.com", subject: "S", html: "<p>x</p>" });
    expect(res.status).toBe("failed");
    expect(res.retryable).toBe(false);
    expect(res.error).toContain("write timeout");
  });

  it("is created by createMailer factory", async () => {
    const sink = vi.fn();
    const mailer = await createMailer(
      { provider: "export_only", fromAddress: "a@example.com" },
      { exportSink: sink },
    );
    expect(mailer.provider).toBe("export_only");
    expect(mailer.capabilities.supportsTestConnection).toBe(true);
  });
});
