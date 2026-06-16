export type ConnectionState =
  | "connected"
  | "reconnecting"
  | "offline"
  | "server_unavailable"
  | "session_ended";

export interface ConnectionContextValue {
  state: ConnectionState;
  lastCheckedAt: number | null;
  reportApiError: (status: number) => void;
}
