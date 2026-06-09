import QRCode from "qrcode";
import { buildTicketUrl } from "./url.js";

/** Generate a PNG QR code for the given payload. Returns a Buffer. */
export async function generateQrPng(payload: string): Promise<Buffer> {
  return QRCode.toBuffer(payload, { type: "png", errorCorrectionLevel: "M" });
}

/**
 * Build the QR payload string:
 *   Mode A — ticket URL (https://<host>/t/<token>), camera-friendly.
 *   Mode B — original agency qr_payload verbatim.
 */
export function buildQrPayload(mode: "internal", params: { baseUrl: string; token: string }): string;
export function buildQrPayload(mode: "agency", params: { agencyPayload: string }): string;
export function buildQrPayload(
  mode: "internal" | "agency",
  params: { baseUrl: string; token: string } | { agencyPayload: string },
): string {
  if (mode === "internal") {
    const internal = params as { baseUrl: string; token: string };
    return buildTicketUrl(internal.baseUrl, internal.token);
  }
  const agency = params as { agencyPayload: string };
  return agency.agencyPayload;
}
