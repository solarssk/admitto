export type TicketMode = "internal" | "agency";

export type ResolveTicketContext = {
  eventId?: string;
};

/**
 * Result of issueTicket().
 *
 * "issued"        — Mode A, token minted for the first time. Raw token is returned ONLY here;
 *                   it is not stored in DB and cannot be recovered later.
 * "already_issued" — Mode A, token_hash already set. Idempotent no-op; raw token unavailable.
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
};

export type CheckInAttendeeInfo = {
  name: string;
  ticket_type: string | null;
};

export type CheckInResult =
  | { status: "VALID";              attendee: CheckInAttendeeInfo; admittedAt: Date }
  | { status: "ALREADY_CHECKED_IN"; attendee: CheckInAttendeeInfo; admittedAt: Date }
  | { status: "REVOKED";            attendee: CheckInAttendeeInfo }
  | { status: "INVALID" };

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
