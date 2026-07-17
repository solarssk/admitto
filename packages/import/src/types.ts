export type AttendeeRow = {
  /** 1-based line index in the parsed CSV (header is line 0; first data row is 1). */
  rowIndex: number;
  first_name: string;
  last_name: string;
  email: string;
  ticket_type?: string;
  external_uuid?: string;
  qr_payload?: string;
  company?: string;
  department?: string;
  /** Event-item attribute values keyed by source_field slug. */
  custom_data?: Record<string, string>;
};

/** Event-item contents row shape for CSV attribute columns (mirrors @admitto/tickets). */
export type ImportAttributeField = {
  label: string;
  source_field: string;
  type?: "text" | "select" | "boolean";
  required?: boolean;
  options?: string[];
};

/** Minimal per-event ticket-type catalog shape for import validation (batch 04 / #351) - key +
 * label only, not the full TicketTypeInfo (color/sort_order are irrelevant to import). */
export type ImportTicketType = {
  key: string;
  label: string;
};

export type ParseAttendeesOptions = {
  attributeFields?: ImportAttributeField[];
  /** Undefined = caller didn't opt into ticket-type validation (today's free-text behavior).
   * Provided (even []) = every non-empty ticket_type value must match a catalog entry. */
  ticketTypes?: ImportTicketType[];
};

export type InvalidRow = {
  rowIndex: number;
  raw: Record<string, string>;
  reason: string;
};

export type ParseResult = {
  validRows: AttendeeRow[];
  invalidRows: InvalidRow[];
  warnings: string[];
};

export type ImportOptions = {
  /** When false (default): never update an existing attendee — always skip. */
  overwrite?: boolean;
  /** When true: count rows only, write nothing to DB. */
  dryRun?: boolean;
  /** When true: caller owns the transaction (no nested $transaction wrapper). */
  ownedTransaction?: boolean;
  /** Event-item attribute definitions — required for custom_data validation at commit. */
  attributeFields?: ImportAttributeField[];
  /** Same opt-in semantics as ParseAttendeesOptions.ticketTypes — re-validated at commit since
   * the catalog can change between preview and commit (a type deleted after the CSV was
   * previewed). */
  ticketTypes?: ImportTicketType[];
  /** Committing admin's IANA timezone at commit time, when known — applied to every created
   * row in this batch (one commit click, one moment, shared across the whole file). */
  timezone?: string;
};

export type SkippedRow = { email: string; reason: string };

export type ImportSummary = {
  toCreate: number;
  toUpdate: number;
  /** Final skip count after commit (includes runtime insert conflicts in `skipped`). */
  toSkip: number;
  /** 0 in dry-run */
  created: number;
  /** 0 in dry-run */
  updated: number;
  skipped: SkippedRow[];
};
