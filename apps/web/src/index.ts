import { serve } from "@hono/node-server";
import { prisma } from "@admitto/db";
import { createApp } from "./app.js";
import { validateCfAccessBootConfig } from "./config.js";

async function main(): Promise<void> {
  await validateCfAccessBootConfig(prisma);
  const app = createApp();
  const port = parseInt(process.env["PORT"] ?? "3000", 10);
  serve({ fetch: app.fetch, port }, () => {
    console.log(`Admitto web running at http://localhost:${port}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
