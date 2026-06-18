export type AttendeeRow = {
  first_name: string;
  last_name: string;
  email: string;
  ticket_type?: string;
  external_uuid?: string;
  qr_payload?: string;
  company?: string;
  department?: string;
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
