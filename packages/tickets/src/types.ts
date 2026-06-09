export type TicketMode = "internal" | "agency";

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
    };

export type IssueEventSummary = {
  results: IssuedTicketResult[];
  issued: number;
  alreadyIssued: number;
  agency: number;
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
