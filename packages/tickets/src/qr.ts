import QRCode from "qrcode";
import { buildTicketUrl } from "./url.js";
import type { TicketMode } from "./types.js";

/** Generate a PNG QR code for the given payload. Returns a Buffer. */
export async function generateQrPng(payload: string): Promise<Buffer> {
  return QRCode.toBuffer(payload, { type: "png", errorCorrectionLevel: "M" });
}

/**
 * Build the QR payload string:
 *   Mode A — ticket URL (https://<host>/t/<token>), camera-friendly.
 *   Mode B — original agency qr_payload verbatim.
 */
export function buildQrPayload(
  mode: TicketMode,
  params: { baseUrl: string; token: string } | { agencyPayload: string },
): string {
  if (mode === "internal") {
    const { baseUrl, token } = params as { baseUrl: string; token: string };
    return buildTicketUrl(baseUrl, token);
  }
  return (params as { agencyPayload: string }).agencyPayload;
}
