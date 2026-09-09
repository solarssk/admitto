import {
  buildBulletproofButtonHtml,
  buildEmailBoxedSectionHtml,
  buildEmailStatusBadgeImageHtml,
  escapeHtmlText,
} from "@admitto/mail-templates";
import { SEVERITY_COLOR, SEVERITY_LABEL } from "./emailTemplate.js";
import type { NotificationSeverity } from "../types.js";

export interface NotificationEmailContentParams {
  severity: NotificationSeverity;
  title: string;
  body: string;
  /** "" when there is no metadata - the Details box is omitted entirely in that case. */
  metadataLine: string;
  ctaUrl: string;
  ctaLabel: string;
  /** Absolute URL of this severity's badge PNG (`/assets/notification-badge-{severity}.png`) -
   * resolved by the caller (email.ts already has BASE_URL in scope), not by this function. */
  badgeImageUrl: string;
}

/** Notification-specific email content: severity badge + title + body (mirrors the mail
 * transport test's own status+title row), an optional "Details" box for metadata (mirrors that
 * test's Diagnostics box - each entry on its own line for readability, not one dense
 * middot-joined sentence), and a CTA button (no transport-test equivalent, stays local here). */
export function buildNotificationEmailBodyHtml(params: NotificationEmailContentParams): string {
  const color = SEVERITY_COLOR[params.severity];

  const statusHtml =
    `<tr><td align="center" style="padding:28px 28px 8px 28px;font-family:Arial,Helvetica,sans-serif;">` +
    buildEmailStatusBadgeImageHtml({
      imageUrl: params.badgeImageUrl,
      labelColor: color,
      labelText: SEVERITY_LABEL[params.severity],
    }) +
    `<div style="margin-top:18px;font-size:22px;font-weight:700;line-height:28px;color:#111827;text-align:center;">${escapeHtmlText(params.title)}</div>` +
    `<div style="margin-top:10px;font-size:15px;line-height:24px;color:#4b5563;text-align:center;max-width:440px;margin-left:auto;margin-right:auto;">${escapeHtmlText(params.body)}</div>` +
    `</td></tr>`;

  const detailsHtml = params.metadataLine
    ? `<tr><td style="padding:0 28px 20px 28px;font-family:Arial,Helvetica,sans-serif;">` +
      buildEmailBoxedSectionHtml({
        label: "Details",
        innerHtml: params.metadataLine
          .split(" · ")
          .map(
            (line) =>
              `<div style="font-size:12px;line-height:20px;color:#111827;">${escapeHtmlText(line)}</div>`,
          )
          .join(""),
      }) +
      `</td></tr>`
    : "";

  const ctaHtml =
    `<tr><td align="center" style="padding:4px 28px 28px 28px;">` +
    buildBulletproofButtonHtml({
      url: params.ctaUrl,
      label: params.ctaLabel,
      backgroundColor: "#066fd1",
      textColor: "#ffffff",
    }) +
    `</td></tr>`;

  return statusHtml + detailsHtml + ctaHtml;
}
