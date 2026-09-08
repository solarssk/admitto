import { defineConfig } from "vitest/config";
import { vitestCoverage } from "../../vitest.coverage.ts";

export default defineConfig({
  test: {
    coverage: vitestCoverage,
    include: ["test/**/*.test.ts"],
    environment: "node",
    // Pure stub-`db` unit tests (packages/wallet style) — no Postgres connection, so no
    // DATABASE_URL override. ENCRYPTION_KEY/BASE_URL/NODE_ENV are still needed: webhook_url_enc
    // round-trips through real @admitto/crypto, and EmailChannel/WebhookChannel read BASE_URL /
    // branch on NODE_ENV even without a live DB.
    env: {
      ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
      NODE_ENV: "test",
      BASE_URL: "https://admitto.example.com",
    },
  },
});
