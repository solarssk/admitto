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
  } catch (err) {
    console.error("resolveTicket failed:", err);
    return c.html(renderNotFound(), 500);
  }

  if (!resolved) {
    return c.html(renderNotFound(), 404);
  }

  const { attendee, event } = resolved;

  if (attendee.status === "revoked") {
    return c.html(renderRevoked(attendee.name, event.title), 200);
  }

  const baseUrl = process.env["BASE_URL"] ?? "http://localhost:3000";
  const agencyPayload =
    resolved.mode === "agency" ? (attendee.qr_payload ?? attendee.external_uuid ?? null) : null;
  if (resolved.mode === "agency" && agencyPayload === null) {
    console.error(`Agency attendee ${attendee.id} has neither qr_payload nor external_uuid`);
    return c.html(renderNotFound(), 500);
  }
  const qrPayload =
    resolved.mode === "internal"
      ? buildQrPayload("internal", { baseUrl, token })
      : buildQrPayload("agency", { agencyPayload: agencyPayload! });

  const qrPng = await generateQrPng(qrPayload);
  const qrDataUrl = `data:image/png;base64,${qrPng.toString("base64")}`;

  return c.html(renderTicket(resolved, qrDataUrl), 200);
});

const port = parseInt(process.env["PORT"] ?? "3000", 10);
serve({ fetch: app.fetch, port }, () => {
  console.log(`Admitto web running at http://localhost:${port}`);
});
