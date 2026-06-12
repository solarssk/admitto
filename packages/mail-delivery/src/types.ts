export interface SendTicketEmailsResult {
  batchId: string;
  sent: number;
  skipped: Array<{ attendeeId: string; reason: string }>;
}
