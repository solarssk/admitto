import { useEffect, useState } from "react";
import { Navigate, Outlet, Route, Routes, useParams } from "react-router-dom";
import { AdminGuard, OperatorGuard } from "./auth/RoleRouter.js";
import { AuthProvider } from "./auth/AuthProvider.js";
import { ConnectionStateProvider } from "./connection/ConnectionStateProvider.js";
import { AdminShell } from "./layouts/AdminShell.js";
import { OperatorShell } from "./layouts/OperatorShell.js";
import { EventsPickerPage } from "./pages/EventsPickerPage.js";
import { CheckInEntryPage } from "./pages/CheckInEntryPage.js";
import { CheckInPage } from "./pages/CheckInPage.js";
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
        const events = await fetchAdminEvents();
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

  if (error) return <Navigate to="/admin" replace />;
  if (!event) return <p>Loading event…</p>;

  return <AdminShell event={event} />;
}

export default function App() {
  return (
    <AuthProvider>
      <ConnectionStateProvider>
        <Routes>
          <Route path="/admin" element={<AdminGuard />}>
            <Route index element={<EventsPickerPage />} />
            <Route path="events/:eventId" element={<EventLayout />}>
              <Route index element={<Navigate to="overview" replace />} />
              {PLACEHOLDER_ROUTES.map((r) => (
                <Route
                  key={r.path}
                  path={r.path}
                  element={
                    r.path === "checkin" ? (
                      <CheckInPage />
                    ) : (
                      <PlaceholderPage title={r.title} />
                    )
                  }
                />
              ))}
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
  );
}
