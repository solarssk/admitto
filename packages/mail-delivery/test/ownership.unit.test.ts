import { afterEach, expect, it, vi } from "vitest";
import { withDeliveryOwnership } from "../src/ownership.js";
afterEach(() => { vi.unstubAllEnvs(); });
it("refuses delivery ownership without database configuration", () => {
  vi.stubEnv("DATABASE_URL", undefined);
  expect(() => withDeliveryOwnership("synthetic", async () => true)).toThrow("Delivery ownership requires database configuration");
});
