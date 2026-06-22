import { useEffect, useState } from "react";
import { Navigate, Outlet, Route, Routes, useNavigate, useParams } from "react-router-dom";
import { AdminGuard, OperatorGuard, SuperadminGuard } from "./auth/RoleRouter.js";
import { AuthProvider, useAuth } from "./auth/AuthProvider.js";
import { isSuperadmin } from "./auth/capabilities.js";
import { ConnectionStateProvider } from "./connection/ConnectionStateProvider.js";
import { ErrorBoundary } from "./components/ErrorBoundary.js";
import { ConfirmDialog } from "./components/ConfirmDialog.js";
import { AdminShell } from "./layouts/AdminShell.js";
import { EventsListShell } from "./layouts/EventsListShell.js";
import { InstanceSettingsShell } from "./layouts/InstanceSettingsShell.js";
import { SettingsPage } from "./pages/SettingsPage.js";
import { OperatorShell } from "./layouts/OperatorShell.js";
import { EventsPickerPage } from "./pages/EventsPickerPage.js";
import { CheckInEntryPage } from "./pages/CheckInEntryPage.js";
import { CheckInPage } from "./pages/CheckInPage.js";
import { AdminCheckInRoute } from "./pages/AdminCheckInRoute.js";
import { AttendeesPage } from "./pages/AttendeesPage.js";
import { ImportPage } from "./pages/ImportPage.js";
import { RequirementsPage } from "./pages/RequirementsPage.js";
import { CommunicationPage } from "./pages/CommunicationPage.js";
import { PlaceholderPage } from "./pages/PlaceholderPage.js";
import { ApiError, archiveEvent, fetchAdminEvents } from "./api/client.js";
import type { EventDto } from "./api/types.js";

const PLACEHOLDER_ROUTES = [
  { path: "overview", title: "Overview" },
  { path: "attendees", title: "Attendees" },
  { path: "requirements", title: "Requirements" },
  { path: "approval", title: "Approval & waitlist" },
  { path: "communication", title: "Communication" },
  { path: "wallet", title: "Wallet passes" },
  { path: "checkin", title: "Check-in" },
  { path: "fulfilment", title: "Fulfilment" },
  { path: "thank-you", title: "Thank you" },
  { path: "reports", title: "Reports" },
] as const;

/** Event-scoped layout: resolves event (incl. archived), archive dialog, and AdminShell. */
function EventLayout() {
  const { eventId } = useParams();
  const navigate = useNavigate();
  const { assignments } = useAuth();
  const [event, setEvent] = useState<EventDto | null>(null);
  const [error, setError] = useState(false);
  const [archiveDialogOpen, setArchiveDialogOpen] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);

  useEffect(() => {
    setEvent(null);
    setError(false);
    let cancelled = false;
    (async () => {
      try {
        const events = await fetchAdminEvents({ includeArchived: true });
        if (cancelled) return;
        const found = events.find((e) => e.id === eventId);
        if (!found) {
          setError(true);
          return;
        }
        setEvent(found);
      } catch (err) {
        if (!cancelled) setError(true);
        if (err instanceof ApiError && err.status === 401) {
          const next = encodeURIComponent(window.location.pathname);
          window.location.assign(`/login?next=${next}`);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  const handleArchive = async () => {
    if (!eventId) return;
    setArchiving(true);
    setArchiveError(null);
    try {
      await archiveEvent(eventId);
      setArchiveDialogOpen(false);
      navigate("/admin");
    } catch (err) {
      setArchiveError(err instanceof ApiError ? err.message : "Failed to archive event.");
    } finally {
      setArchiving(false);
    }
  };

  if (error) return <Navigate to="/admin" replace />;
  if (!event) return <p>Loading event…</p>;

  const showArchiveButton = isSuperadmin(assignments) && !event.archived_at;

  return (
    <>
      <AdminShell
        event={event}
        showArchiveButton={showArchiveButton}
        onArchiveRequest={() => {
          setArchiveError(null);
          setArchiveDialogOpen(true);
        }}
      />
      <ConfirmDialog
        open={archiveDialogOpen}
        title="Archive event"
        message="Archived events are hidden and read-only. Data is preserved. A superadmin can unarchive later."
        errorMessage={archiveError}
        confirmLabel="Archive"
        confirmVariant="danger"
        loading={archiving}
        onConfirm={() => void handleArchive()}
        onCancel={() => {
          if (!archiving) {
            setArchiveDialogOpen(false);
            setArchiveError(null);
          }
        }}
      />
    </>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <ConnectionStateProvider>
          <Routes>
          <Route path="/admin" element={<AdminGuard />}>
          <Route element={<EventsListShell />}>
            <Route index element={<EventsPickerPage />} />
          </Route>
            <Route path="settings" element={<SuperadminGuard />}>
              <Route element={<InstanceSettingsShell />}>
                <Route index element={<SettingsPage />} />
              </Route>
            </Route>
            <Route path="events/:eventId" element={<EventLayout />}>
              <Route index element={<Navigate to="overview" replace />} />
              {PLACEHOLDER_ROUTES.map((r) => (
                <Route
                  key={r.path}
                  path={r.path}
                  element={
                    r.path === "checkin" ? (
                      <AdminCheckInRoute />
                    ) : r.path === "attendees" ? (
                      <AttendeesPage />
                    ) : r.path === "requirements" ? (
                      <RequirementsPage />
                    ) : r.path === "communication" ? (
                      <CommunicationPage />
                    ) : (
                      <PlaceholderPage title={r.title} />
                    )
                  }
                />
              ))}
              <Route path="attendees/import" element={<ImportPage />} />
              <Route path="*" element={<Navigate to="overview" replace />} />
            </Route>
          </Route>
          <Route path="/operator" element={<OperatorGuard />}>
            <Route element={<OperatorShell />}>
              <Route index element={<CheckInEntryPage />} />
              <Route path="events/:eventId/checkin" element={<CheckInPage />} />
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Routes>
        </ConnectionStateProvider>
      </AuthProvider>
    </ErrorBoundary>
  );
}
