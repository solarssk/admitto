import { Card, PageHeader } from "@admitto/ui";
import { useParams } from "react-router-dom";

export function CheckInPlaceholderPage() {
  const { eventId } = useParams();

  return (
    <Card className="checkin-placeholder">
      <PageHeader
        title="Check-in"
        subtitle="Scan UI and shared CheckInSurface arrive in PR #2."
      />
      <p className="placeholder-note">
        Event <code>{eventId}</code> — camera scan, history, and server-confirmed results will use the same
        surface under both <code>/operator/events/:id/checkin</code> and{" "}
        <code>/admin/events/:id/checkin</code>.
      </p>
      <p className="placeholder-note">
        Not connected — scans are NOT being confirmed by the server until the check-in module ships.
      </p>
    </Card>
  );
}
