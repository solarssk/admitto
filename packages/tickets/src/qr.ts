import QRCode from "qrcode";

/** Generate a PNG QR code for the given payload. Returns a Buffer. */
export async function generateQrPng(payload: string): Promise<Buffer> {
  return QRCode.toBuffer(payload, { type: "png", errorCorrectionLevel: "M" });
}

/**
 * Build the QR/barcode payload string:
 *   Mode A: the raw internal token, not a URL. Only Admitto's own scanners (check-in,
 *   resolveTicket) ever read this value, so there's no benefit to it being independently
 *   openable, and a shorter payload scans more reliably than a full URL would.
 *   Mode B: original agency qr_payload verbatim.
 */
export function buildQrPayload(mode: "internal", params: { token: string }): string;
export function buildQrPayload(mode: "agency", params: { agencyPayload: string }): string;
export function buildQrPayload(
  mode: "internal" | "agency",
  params: { token: string } | { agencyPayload: string },
): string {
  if (mode === "internal") {
    return (params as { token: string }).token;
  }
  return (params as { agencyPayload: string }).agencyPayload;
}
