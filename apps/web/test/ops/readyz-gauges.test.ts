import { describe, expect, it, vi } from "vitest";
import { collectGauges } from "../../src/ops/readyz.js";

describe("collectGauges bounce_ingest fields", () => {
  it("reports zero problems when no bounce configs are enabled", async () => {
    const db = {
      emailDelivery: {
        count: vi.fn().mockResolvedValue(0),
      },
      bounceIngestSettings: {
        findMany: vi.fn().mockResolvedValue([{ enabled: false, last_run_at: null, last_run_ok: null }]),
      },
    };
    await expect(collectGauges(db as never)).resolves.toEqual({
      email_deliveries_queued: 0,
      email_deliveries_failed_retryable: 0,
      bounce_ingest_enabled: 0,
      bounce_ingest_problem: 0,
    });
  });

  it("counts enabled configs that need attention", async () => {
    const db = {
      emailDelivery: {
        count: vi.fn().mockResolvedValue(0),
      },
      bounceIngestSettings: {
        findMany: vi.fn().mockResolvedValue([
          {
            enabled: true,
            last_run_at: null,
            last_run_ok: null,
            poll_interval_minutes: 5,
          },
        ]),
      },
    };
    await expect(collectGauges(db as never)).resolves.toMatchObject({
      bounce_ingest_enabled: 1,
      bounce_ingest_problem: 1,
    });
  });
});
