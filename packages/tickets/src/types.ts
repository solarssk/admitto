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
  timezone?: string;
};

export type EventItemContent = {
  label: string;
  source_field: string;
  type?: "text" | "select" | "boolean";
  required?: boolean;
  options?: string[];
};

/** Per-item JSON config: operator hints and issuance behaviour flags (ADR 0025).
 * `content_fields` references EventCustomField rows by source_field - it does not embed field
 * definitions (that would let two items independently redeclare the same field with conflicting
 * metadata, which is exactly the bug class the registry exists to prevent). */
export type EventItemConfig = {
  content_fields?: string[];
  requires_return?: boolean;
  issue_on_checkin?: boolean;
};

export type AttendeeCardItemDto = {
  key: string;
  label: string;
  /** Admin-configured item description (Requirements page), capped at 500 chars server-side. */
  description?: string | null;
  icon: string | null;
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
  items: AttendeeCardItemDto[];
  notes: { body: string; author_display: string; created_at: string }[];
  /**
   * True when the pass itself isn't admittable (cancelled/revoked). The UI only
   * ever needed the boolean — it derives the red "Revoked"/"Invalid ticket"
   * badge and blocks item actions from this, and never rendered the old warning
   * strings (removed in the check-in card redesign).
   */
  blocked: boolean;
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
    slug: string;
    date: Date;
    /** IANA timezone for the event calendar day (weather / display). */
    timezone: string;
    /** Optional 24h "HH:MM" event start/end time, shown as a range on the ticket. */
    eventHoursStart: string | null;
    eventHoursEnd: string | null;
    /** Master switch for this event's wallet feature; off hides both platforms regardless of the
     * per-platform switches below. */
    walletEnabled: boolean;
    /** PassCreator template for this event's wallet passes; null disables wallet passes. */
    walletTemplateId: string | null;
    /** Encrypted PassCreator API key for this event; null disables wallet passes. Never sent to
     * the client - only used server-side to build the provider client. */
    walletApiKeyEnc: string | null;
    walletAppleEnabled: boolean;
    walletGoogleEnabled: boolean;
    /** PassCreator field key -> Admitto placeholder token; null/empty uses the default mapping. */
    walletFieldMapping: Record<string, string> | null;
    /** Short venue display name (`EventLocation.venue_name`). */
    location: string | null;
    logoUrl: string | null;
    /** Full address line from geocoding / Location tab; null when unset. */
    formattedAddress: string | null;
    /**
     * Structured Location-tab address grid when persisted (preferred for Getting There /
     * mail `{{event_address}}` over the long Nominatim `formatted_address`).
     */
    addressComponents: {
      object_name: string | null;
      street: string | null;
      postcode: string | null;
      city: string | null;
      region: string | null;
      country: string | null;
    } | null;
    latitude: number | null;
    longitude: number | null;
    mapZoom: number | null;
    directionsText: string | null;
    accessibilityText: string | null;
    /** Manual Google Maps URL when set; otherwise ticket builds from lat/lng. */
    googleMapsUrlOverride: string | null;
    /** Manual Apple Maps URL when set; otherwise ticket builds from lat/lng. */
    appleMapsUrlOverride: string | null;
  };
};
