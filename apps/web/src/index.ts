import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { Prisma } from "@prisma/client";
import { prisma } from "@admitto/db";
import { resolveTicket, generateQrPng, buildQrPayload } from "@admitto/tickets";
import { renderTicket, renderNotFound, renderRevoked, renderServerError } from "./ticket-page.js";
import { resolveBaseUrl } from "./config.js";

// Fail-fast in production: BASE_URL must be set explicitly.
// In non-production environments the localhost fallback is acceptable.
const baseUrl = resolveBaseUrl();

const app = new Hono();

app.get("/t/:token", async (c) => {
  const token = c.req.param("token");

  let resolved;
  try {
    resolved = await resolveTicket(token, prisma);
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientInitializationError ||
      err instanceof Prisma.PrismaClientKnownRequestError ||
      err instanceof Prisma.PrismaClientUnknownRequestError
    ) {
      console.error("resolveTicket database error:", err);
    } else {
      console.error("resolveTicket unexpected error:", err);
    }
    return c.html(renderServerError(), 500);
  }

  if (!resolved) {
    return c.html(renderNotFound(), 404);
  }

  const { attendee, event } = resolved;

  if (attendee.status === "revoked" || attendee.status === "cancelled") {
    return c.html(renderRevoked(attendee.name, event.title, attendee.status), 410);
  }

  let qrPayload: string;
  if (resolved.mode === "internal") {
    qrPayload = buildQrPayload("internal", { baseUrl, token });
  } else {
    const agencyPayload = attendee.qr_payload ?? attendee.external_uuid;
    if (!agencyPayload) {
      console.error(`Agency attendee ${attendee.id} has neither qr_payload nor external_uuid`);
      return c.html(renderServerError(), 500);
    }
    qrPayload = buildQrPayload("agency", { agencyPayload });
  }

  let qrDataUrl: string;
  try {
    const qrPng = await generateQrPng(qrPayload);
    qrDataUrl = `data:image/png;base64,${qrPng.toString("base64")}`;
  } catch (err) {
    console.error("generateQrPng failed:", err);
    return c.html(renderServerError(), 500);
  }

  return c.html(renderTicket(resolved, qrDataUrl), 200);
});

const port = parseInt(process.env["PORT"] ?? "3000", 10);
serve({ fetch: app.fetch, port }, () => {
  console.log(`Admitto web running at http://localhost:${port}`);
});
