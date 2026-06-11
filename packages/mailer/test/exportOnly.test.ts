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

  it("is created by createMailer factory", () => {
    const sink = vi.fn();
    const mailer = createMailer(
      { provider: "export_only", fromAddress: "a@example.com" },
      { exportSink: sink },
    );
    expect(mailer.provider).toBe("export_only");
    expect(mailer.capabilities.supportsTestConnection).toBe(true);
  });
});
