export type TicketMode = "internal" | "agency";

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
