/**
 * Runtime copy of `_ops/design/system-notification-email.mjml` (design source of truth, not
 * shipped in the built image - same pattern as packages/mail-templates/src/defaultTemplate.ts's
 * DEFAULT_BODY_MJML). Keep byte-for-byte in sync with that file; every notification type renders
 * through this one layout (ADR 0044 §7) - no per-type visual design.
 *
 * Placeholders are substituted as literal text via escapeHtmlText/escapeHtmlAttribute
 * (see substitute.ts) - never interpolated as HTML, so a notification body can never inject
 * markup into this template.
 */
export const SYSTEM_NOTIFICATION_EMAIL_MJML = `<mjml>
  <mj-head>
    <mj-attributes>
      <mj-all font-family="Arial, Helvetica, sans-serif" />
      <mj-text font-size="14px" line-height="22px" color="#1d273b" />
    </mj-attributes>
  </mj-head>
  <mj-body background-color="#f1f5f9" width="600px">

    <!-- severity bar -->
    <mj-section background-color="{{severity_color}}" padding="6px 0" />

    <mj-section background-color="#ffffff" padding="32px 32px 8px 32px">
      <mj-column>
        <mj-text font-size="12px" font-weight="700" letter-spacing="1px" text-transform="uppercase" color="#94a3b8" padding-bottom="6px">
          ADMITTO SYSTEM
        </mj-text>
        <mj-text font-size="12px" font-weight="700" letter-spacing="1px" text-transform="uppercase" color="{{severity_color}}" padding-bottom="18px">
          {{severity_label}}
        </mj-text>
        <mj-text font-size="20px" font-weight="700" line-height="28px" color="#1d273b" padding-bottom="12px">
          {{title}}
        </mj-text>
        <mj-text padding-bottom="16px">
          {{body}}
        </mj-text>
        <mj-text font-size="12px" color="#64748b" padding-bottom="8px">
          {{metadata_line}}
        </mj-text>
      </mj-column>
    </mj-section>

    <mj-section background-color="#ffffff" padding="8px 32px 32px 32px">
      <mj-column>
        <mj-button href="{{cta_url}}" background-color="#066fd1" color="#ffffff" font-size="14px" font-weight="600" inner-padding="10px 22px" border-radius="4px">
          {{cta_label}}
        </mj-button>
      </mj-column>
    </mj-section>

    <mj-section background-color="#f1f5f9" padding="20px 32px">
      <mj-column>
        <mj-text font-size="12px" line-height="18px" color="#94a3b8" align="center">
          Automated system notification from Admitto - sent because your account has the admin or superadmin role on this instance. Manage recipients in Settings → System notifications.
        </mj-text>
      </mj-column>
    </mj-section>

  </mj-body>
</mjml>
`;

/** Same 3 severities as NotificationSeverity/SystemLogLevel - hex values match
 * packages/ui/src/styles/tokens/colors.css (--status-error/--status-warn/--status-info), the
 * same source ADR 0038 §4 already draws Discord embed colors from. */
export const SEVERITY_COLOR: Record<"info" | "warn" | "error", string> = {
  info: "#4299e1",
  warn: "#f59f00",
  error: "#d63939",
};

export const SEVERITY_LABEL: Record<"info" | "warn" | "error", string> = {
  info: "Info",
  warn: "Warning",
  error: "Alert",
};
