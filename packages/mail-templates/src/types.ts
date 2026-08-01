export type TemplateFormat = "mjml" | "html";

export type TemplateScopeType = "organization" | "event";

export interface TemplateScope {
  scopeType: TemplateScopeType;
  scopeId: string;
  /** Template slug within scope; defaults to `ticket` for legacy single-template upsert. */
  name?: string;
}

export type TemplateSource = "event" | "organization" | "builtin";

export interface ResolvedTemplate {
  subjectTemplate: string;
  compiledHtmlTemplate: string;
  templateFormat: TemplateFormat;
  source: TemplateSource;
  /** Set when resolved from a MailTemplate row (for EmailDelivery.template_id). */
  templateId?: string;
  /** The row's label, for EmailDelivery.template_label_snapshot - set whenever templateId is,
   * so a later template deletion doesn't erase what it was called. */
  templateLabel?: string;
}

export interface TemplateVars {
  first_name?: string;
  last_name?: string;
  full_name?: string;
  email?: string;
  event_name?: string;
  event_date?: string;
  event_location?: string;
  ticket_url?: string;
  qr_image_url?: string;
  logo_url?: string;
  header_image_url?: string;
  apple_wallet_url?: string;
  google_wallet_url?: string;
  download_page_url?: string;
  // Per-event custom image asset tokens (branding asset library, v0.4.13 batch 05) - dynamic
  // {{token}} names decided by the admin at upload time, not known ahead of time like the
  // fields above. See resolveEventImageAssetVars in branding.ts.
  [customAssetToken: string]: string | undefined;
}

export interface RenderedTemplate {
  subject: string;
  html: string;
}

export interface BrandingUrls {
  logo_url: string;
  header_image_url: string;
}

export interface SetMailTemplateInput {
  subject: string;
  body: string;
  format: TemplateFormat;
  label?: string;
}
