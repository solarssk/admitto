import { serve } from "@hono/node-server";
import { createApp } from "./app.js";

const app = createApp();

const port = parseInt(process.env["PORT"] ?? "3000", 10);
serve({ fetch: app.fetch, port }, () => {
  console.log(`Admitto web running at http://localhost:${port}`);
});
