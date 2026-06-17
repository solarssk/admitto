export type TicketMode = "internal" | "agency";

export type ResolveTicketContext = {
  eventId?: string;
};

/**
 * Result of issueTicket().
 *
 * "issued"        — Mode A, token minted for the first time. Raw token is returned ONLY here;
 *                   token_enc in DB allows same-link resend (ADR 0006) but not full re-issue.
 * "already_issued" — Mode A, token_hash already set. Idempotent no-op; raw token not re-returned.
 * "agency"        — Mode B, no internal token minted; agency payload returned verbatim.
 */
export type IssuedTicketResult =
  | {
      status: "issued";
      mode: "internal";
      attendeeId: string;
      token: string;
      tokenHash: string;
      ticketUrl: string;
    }
  | {
      status: "already_issued";
      mode: "internal";
      attendeeId: string;
    }
  | {
      status: "agency";
      mode: "agency";
      attendeeId: string;
      qrPayload: string;
    }
  | {
      status: "not_issuable";
      mode: "internal";
      attendeeId: string;
      reason: "cancelled" | "revoked";
    };

export type IssueEventSummary = {
  results: IssuedTicketResult[];
  issued: number;
  alreadyIssued: number;
  agency: number;
  notIssuable: number;
};

export type CheckInScanParams = {
  scanned: string;
  eventId: string;
  operator?: string;
  deviceId?: string;
  sessionId?: string;
  ip?: string;
};

export type EventItemContent = { label: string; source_field: string };

export type EventItemConfig = {
  contents?: EventItemContent[];
  requires_return?: boolean;
  issue_on_checkin?: boolean;
};

export type AttendeeCardItemDto = {
  key: string;
  label: string;
  state: string;
  actions: string[];
  /** Optional operator hint (e.g. shirt size for giftbag contents). */
  detail?: string | null;
};

export type AttendeeCardDto = {
  id: string;
  name: string;
  company: string | null;
  department: string | null;
  ticket_type: string | null;
  check_in_status: "not_admitted" | "admitted";
  admitted_at: string | null;
  shirt_size: string | null;
  items: AttendeeCardItemDto[];
  notes: { body: string; author_display: string; created_at: string }[];
  warnings: string[];
};

export type LookupAttendeeResult = {
  id: string;
  name: string;
  ticket_type: string | null;
  company: string | null;
  department: string | null;
  check_in_status: "not_admitted" | "admitted";
};

export type AdmitResult =
  | { status: "VALID"; confirmed: true; card: AttendeeCardDto; admittedAt: Date }
  | { status: "ALREADY_CHECKED_IN"; confirmed: true; card: AttendeeCardDto; admittedAt: Date }
  | { status: "REVOKED"; confirmed: false; card: AttendeeCardDto }
  | { status: "INVALID"; confirmed: false };

export type CheckInScanResult =
  | AdmitResult
  | { status: "INVALID"; confirmed: false }
  | { status: "PREVIEW"; confirmed: false; card?: AttendeeCardDto; attendeeId: string };

export type UndoCheckInResult = { card: AttendeeCardDto };

export type CheckInAttendeeInfo = {
  name: string;
  ticket_type: string | null;
};

/** @deprecated Legacy scan result — prefer CheckInScanResult */
export type CheckInResult =
  | { status: "VALID";              attendee: CheckInAttendeeInfo; admittedAt: Date }
  | { status: "ALREADY_CHECKED_IN"; attendee: CheckInAttendeeInfo; admittedAt: Date }
  | { status: "REVOKED";            attendee: CheckInAttendeeInfo }
  | { status: "INVALID" };

export type CheckInHistoryEntry = {
  id: string;
  event_id: string;
  attendee_id: string;
  status: string;
  checked_in_at: Date;
  checked_in_by: string | null;
  device_id: string | null;
  source: string | null;
  notes: string | null;
  created_at: Date;
  attendee: {
    name: string;
    ticket_type: string | null;
    company?: string | null;
    department?: string | null;
  };
};

export type ResolvedTicket = {
  mode: TicketMode;
  attendee: {
    id: string;
    event_id: string;
    email: string;
    name: string;
    status: string;
    token_hash: string | null;
    qr_payload: string | null;
    external_uuid: string | null;
    ticket_type: string | null;
  };
  event: {
    id: string;
    title: string;
    date: Date;
    location: string | null;
  };
};
