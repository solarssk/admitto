import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { prisma } from "@admitto/db";
import { resolveTicket, generateQrPng, buildQrPayload } from "@admitto/tickets";
import { renderTicket, renderNotFound, renderRevoked } from "./ticket-page.js";

const app = new Hono();

app.get("/t/:token", async (c) => {
  const token = c.req.param("token");

  let resolved;
  try {
    resolved = await resolveTicket(token, prisma);
  } catch {
    return c.html(renderNotFound(), 503);
  }

  if (!resolved) {
    return c.html(renderNotFound(), 404);
  }

  const { attendee, event } = resolved;

  if (attendee.status === "revoked") {
    return c.html(renderRevoked(attendee.name, event.title), 200);
  }

  const baseUrl = process.env["BASE_URL"] ?? `https://${c.req.header("host") ?? "localhost"}`;
  const qrPayload =
    resolved.mode === "internal"
      ? buildQrPayload("internal", { baseUrl, token })
      : buildQrPayload("agency", {
          agencyPayload: attendee.qr_payload ?? attendee.external_uuid ?? token,
        });

  const qrPng = await generateQrPng(qrPayload);
  const qrDataUrl = `data:image/png;base64,${qrPng.toString("base64")}`;

  return c.html(renderTicket(resolved, qrDataUrl), 200);
});

const port = parseInt(process.env["PORT"] ?? "3000", 10);
serve({ fetch: app.fetch, port }, () => {
  console.log(`Admitto web running at http://localhost:${port}`);
});
