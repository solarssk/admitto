import { useEffect, useRef, useState } from "react";
import { Navigate, Outlet, Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom";
import { Spinner } from "@admitto/ui";
import { ToastProvider } from "@admitto/ui";
import { AdminGuard, AuthenticatedGuard, OperatorGuard, SuperadminGuard } from "./auth/RoleRouter.js";
import { OperatorDeviceGate } from "./auth/OperatorDeviceGate.js";
import { AuthProvider, useAuth } from "./auth/AuthProvider.js";
import { isSuperadmin } from "./auth/capabilities.js";
import { ConnectionStateProvider } from "./connection/ConnectionStateProvider.js";
import { ErrorBoundary } from "./components/ErrorBoundary.js";
import { DemoBar } from "./components/DemoBar.js";
import { AdminShell } from "./layouts/AdminShell.js";
import { EventsListShell } from "./layouts/EventsListShell.js";
import { InstanceSettingsShell } from "./layouts/InstanceSettingsShell.js";
import { SettingsPage } from "./pages/SettingsPage.js";
import { IdentityLayout } from "./identity/IdentityLayout.js";
import { IdentityProvidersPanel } from "./identity/IdentityProvidersPanel.js";
import { IdentityProviderEditor } from "./identity/IdentityProviderEditor.js";
import { CfAccessEditor } from "./identity/CfAccessEditor.js";
import { UsersPage } from "./pages/UsersPage.js";
import { OperatorShell } from "./layouts/OperatorShell.js";
import { AccountShell } from "./layouts/AccountShell.js";
import { AccountLayout } from "./account/AccountLayout.js";
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
import { ReportsPage } from "./pages/ReportsPage.js";
import { PlaceholderPage } from "./pages/PlaceholderPage.js";
import { SetupWizardPage } from "./pages/SetupWizardPage.js";
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

/** Event passed through router navigation state (events picker, create-event
 * flow), if it matches the route's eventId. */
function eventFromNavigationState(state: unknown, eventId: string | undefined): EventDto | null {
  if (!eventId || typeof state !== "object" || state === null) return null;
  const candidate = (state as { event?: EventDto }).event;
  return candidate && typeof candidate === "object" && candidate.id === eventId ? candidate : null;
}

/** Event-scoped layout: resolves event (incl. archived) and AdminShell. */
export function EventLayout() {
  const { eventId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  // Fast path (#274): the events picker (and create-event flow) already hold
  // the full EventDto and pass it via navigation state — render the shell
  // immediately instead of re-fetching the whole events list and flashing a
  // bare spinner. Held in a ref because in-event navigations (which carry no
  // state) change `location` without changing `eventId`, and must not
  // re-trigger the effect below or wipe an already-resolved event.
  const navStateEvent = eventFromNavigationState(location.state, eventId);
  const navStateEventRef = useRef(navStateEvent);
  navStateEventRef.current = navStateEvent;

  const [event, setEvent] = useState<EventDto | null>(navStateEvent);
  const [error, setError] = useState(false);

  useEffect(() => {
    const fromState = navStateEventRef.current;
    setEvent(fromState);
    setError(false);
    if (fromState) {
      // One-shot: strip the event from this history entry's state once
      // consumed. listAdminEvents re-scopes org-admin access on every
      // fallback fetch below, so trusting this snapshot forever would let a
      // later back/forward revisit to this exact entry skip that recheck —
      // e.g. after the admin's org assignment is revoked in the same browser
      // session. Clearing it forces any future visit to this entry through
      // the fallback fetch instead (Codex review).
      navigate(`${location.pathname}${location.search}`, { replace: true, state: null });
      return;
    }
    // Fallback (deep link, refresh without usable state): resolve the event
    // from the API before the shell can render.
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

function StaffRoutes() {
  const { assignments, setupComplete, refresh } = useAuth();

  if (isSuperadmin(assignments) && !setupComplete) {
    return <SetupWizardPage onComplete={refresh} />;
  }

  return (
    <Routes>
      <Route path="/admin" element={<AdminGuard />}>
        <Route element={<EventsListShell />}>
          <Route index element={<EventsPickerPage />} />
          <Route path="users" element={<UsersPage />} />
        </Route>
        <Route path="settings" element={<SuperadminGuard />}>
          <Route element={<InstanceSettingsShell />}>
            <Route index element={<SettingsPage />} />
            <Route path="identity" element={<IdentityLayout />}>
              <Route index element={<Navigate to="providers" replace />} />
              <Route path="providers" element={<IdentityProvidersPanel />} />
              <Route path="providers/new" element={<IdentityProviderEditor mode="create" />} />
              <Route path="providers/:providerId" element={<IdentityProviderEditor mode="edit" />} />
              <Route path="cloudflare" element={<CfAccessEditor />} />
            </Route>
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
                ) : r.path === "reports" ? (
                  <ReportsPage />
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
      <Route path="/account" element={<AuthenticatedGuard />}>
        <Route element={<AccountShell />}>
          <Route index element={<AccountLayout />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/admin" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <ToastProvider>
        <AuthProvider>
          <ConnectionStateProvider>
            <StaffRoutes />
          </ConnectionStateProvider>
        </AuthProvider>
        <DemoBar />
      </ToastProvider>
    </ErrorBoundary>
  );
}
