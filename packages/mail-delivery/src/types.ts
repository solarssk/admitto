export interface SendTicketEmailsResult {
  batchId: string;
  sent: number;
  skipped: Array<{ attendeeId: string; reason: string }>;
  deliveries: Array<{ attendeeId: string; deliveryId: string }>;
  /** The template actually resolved for this send (event override -> org override -> builtin
   * default) - undefined only when the builtin default was used, same as EmailDelivery.template_id. */
  resolvedTemplateId: string | undefined;
}
