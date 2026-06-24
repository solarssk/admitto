import { useEffect, useState } from "react";
import { Navigate, Outlet, Route, Routes, useParams } from "react-router-dom";
import { Spinner } from "@admitto/ui";
import { ToastProvider } from "@admitto/ui";
import { AdminGuard, OperatorGuard, SuperadminGuard } from "./auth/RoleRouter.js";
import { OperatorDeviceGate } from "./auth/OperatorDeviceGate.js";
import { AuthProvider } from "./auth/AuthProvider.js";
import { ConnectionStateProvider } from "./connection/ConnectionStateProvider.js";
import { ErrorBoundary } from "./components/ErrorBoundary.js";
import { DemoBar } from "./components/DemoBar.js";
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
import { AttendeeDetailPage } from "./pages/AttendeeDetailPage.js";
import { EventSettingsPage } from "./pages/EventSettingsPage.js";
import { ImportPage } from "./pages/ImportPage.js";
import { RequirementsPage } from "./pages/RequirementsPage.js";
import { CommunicationPage } from "./pages/CommunicationPage.js";
import { EventOverviewPage } from "./pages/EventOverviewPage.js";
import { PlaceholderPage } from "./pages/PlaceholderPage.js";
import { ApiError, fetchAdminEvents } from "./api/client.js";
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

/** Event-scoped layout: resolves event (incl. archived) and AdminShell. */
function EventLayout() {
  const { eventId } = useParams();
  const [event, setEvent] = useState<EventDto | null>(null);
  const [error, setError] = useState(false);

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
        if (cancelled) return;
        setError(true);
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

  if (error) return <Navigate to="/admin" replace />;
  if (!event) {
    return (
      <div className="shell-loading" role="status">
        <Spinner label="Loading event" />
      </div>
    );
  }

  return <AdminShell event={event} />;
}

export default function App() {
  return (
    <ErrorBoundary>
      <ToastProvider>
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
                        r.path === "overview" ? (
                          <EventOverviewPage />
                        ) : r.path === "checkin" ? (
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
                  <Route path="attendees/:attendeeId" element={<AttendeeDetailPage />} />
                  <Route path="settings" element={<EventSettingsPage />} />
                  <Route path="*" element={<Navigate to="overview" replace />} />
                </Route>
              </Route>
              <Route path="/operator" element={<OperatorGuard />}>
                <Route element={<OperatorDeviceGate />}>
                  <Route element={<OperatorShell />}>
                    <Route index element={<CheckInEntryPage />} />
                    <Route path="events/:eventId/checkin" element={<CheckInPage />} />
                  </Route>
                </Route>
              </Route>
              <Route path="*" element={<Navigate to="/admin" replace />} />
            </Routes>
          </ConnectionStateProvider>
        </AuthProvider>
        <DemoBar />
      </ToastProvider>
    </ErrorBoundary>
  );
}
