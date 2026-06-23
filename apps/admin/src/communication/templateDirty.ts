export type TemplateDraft = {
  subject: string;
  body: string;
  format: "mjml" | "html";
};

/** True when compose fields differ from the last saved snapshot. */
export function isTemplateDirty(current: TemplateDraft, saved: TemplateDraft): boolean {
  return (
    current.subject !== saved.subject ||
    current.body !== saved.body ||
    current.format !== saved.format
  );
}
