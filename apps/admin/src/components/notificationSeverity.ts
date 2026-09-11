/**
 * Matches the colored-circle severity badge the actual notification email renders (see
 * packages/notifications/src/channels/emailContent.ts) - same three severities, same meaning,
 * just a live Tabler icon here instead of a baked PNG. Shared by every place that lists
 * notification types by severity (organisation settings' type matrix, the personal preferences
 * grid, the topbar bell's inbox) rather than redefined per file.
 */
export const NOTIFICATION_SEVERITY_ICON: Record<string, string> = {
  info: "ti-info-circle",
  warn: "ti-alert-triangle",
  error: "ti-alert-circle",
};

/**
 * One-line plain-English explanation per notification type, shown under its label wherever the
 * type×channel matrix appears - Organisation Settings' org-wide toggle grid and My Account's
 * personal preferences grid render the exact same registry types, so this stays a single shared
 * source instead of two copies drifting apart (PO feedback: My Account's grid had no description
 * at all, unlike Organisation Settings'). Falls back to a generic line for any type not listed
 * here - never a hard requirement to keep in sync with the backend registry.
 *
 * Written for a B1/C1 English reader (PO feedback): no abbreviations like "MFA", "SSO", or "CLI" -
 * spell the term out instead ("two-factor authentication", "single sign-on"), and no jargon like
 * "brute-force" or "credential-stuffing" - describe the risk in plain words.
 */
export const NOTIFICATION_TYPE_DESCRIPTIONS: Record<string, string> = {
  "auth.login.repeated_failures":
    "Multiple failed sign-in attempts on an admin account. This can mean someone is trying many passwords to break in.",
  "auth.mfa.break_glass":
    "An operator used the emergency two-factor bypass to reset another admin's two-factor authentication, or to create a one-time recovery code for their account.",
  "auth.settings.changed":
    "Login or security settings changed for the whole organisation, such as the two-factor authentication policy or single sign-on.",
  "auth.login.new_country": "An admin account signed in from a country not seen among its recent successful logins.",
  "auth.role.elevated": "A user was granted the admin or superadmin role.",
};
