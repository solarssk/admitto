import { serve } from "@hono/node-server";
import { prisma } from "@admitto/db";
import { createApp } from "./app.js";
import { validateCfAccessBootConfig } from "./config.js";
import { devConsoleExportSink, warnExportOnlyProductionEnv } from "./dev-export-sink.js";

/** Boot the Admitto web server; wires a dev-only export_only sink when NODE_ENV is development. */
async function main(): Promise<void> {
  await validateCfAccessBootConfig(prisma);
  warnExportOnlyProductionEnv();

  const isDevelopment = process.env.NODE_ENV === "development";
  const app = createApp(
    isDevelopment ? { mailDeliveryDeps: { exportSink: devConsoleExportSink } } : {},
  );
  const port = parseInt(process.env["PORT"] ?? "3000", 10);
  serve({ fetch: app.fetch, port }, () => {
    console.log(`Admitto web running at http://localhost:${port}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
