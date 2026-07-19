import { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
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
import { SettingsLayout } from "./layouts/SettingsLayout.js";
import { OperatorShell } from "./layouts/OperatorShell.js";
import { EventsPickerPage } from "./pages/EventsPickerPage.js";
import { PlaceholderPage } from "./pages/PlaceholderPage.js";
import { ApiError, fetchAdminEvents } from "./api/client.js";
import type { EventDto } from "./api/types.js";

// Route-level code-splitting: each page below loads on demand so the initial
// bundle stays under Vite's 500 kB chunk warning. Guards, providers, and
// shells stay static — they render on every path. React Router wraps
// navigations in startTransition, so an in-app navigation keeps the current
// view while the chunk loads; only a cold load of a lazy route shows the
// Suspense fallback.
const SettingsTabContent = lazy(() => import("./pages/SettingsPage.js").then((m) => ({ default: m.SettingsTabContent })));
const IdentityProvidersPanel = lazy(() => import("./identity/IdentityProvidersPanel.js").then((m) => ({ default: m.IdentityProvidersPanel })));
const IdentityProviderEditor = lazy(() => import("./identity/IdentityProviderEditor.js").then((m) => ({ default: m.IdentityProviderEditor })));
const CfAccessEditor = lazy(() => import("./identity/CfAccessEditor.js").then((m) => ({ default: m.CfAccessEditor })));
const UsersPage = lazy(() => import("./pages/UsersPage.js").then((m) => ({ default: m.UsersPage })));
const AccountLayout = lazy(() => import("./account/AccountLayout.js").then((m) => ({ default: m.AccountLayout })));
const CheckInEntryPage = lazy(() => import("./pages/CheckInEntryPage.js").then((m) => ({ default: m.CheckInEntryPage })));
const CheckInPage = lazy(() => import("./pages/CheckInPage.js").then((m) => ({ default: m.CheckInPage })));
const AdminCheckInRoute = lazy(() => import("./pages/AdminCheckInRoute.js").then((m) => ({ default: m.AdminCheckInRoute })));
const AttendeesPage = lazy(() => import("./pages/AttendeesPage.js").then((m) => ({ default: m.AttendeesPage })));
const AttendeeDetailPage = lazy(() => import("./pages/AttendeeDetailPage.js").then((m) => ({ default: m.AttendeeDetailPage })));
const EventSettingsPage = lazy(() => import("./pages/EventSettingsPage.js").then((m) => ({ default: m.EventSettingsPage })));
const ImportPage = lazy(() => import("./pages/ImportPage.js").then((m) => ({ default: m.ImportPage })));
const RequirementsPage = lazy(() => import("./pages/RequirementsPage.js").then((m) => ({ default: m.RequirementsPage })));
const CommunicationPage = lazy(() => import("./pages/CommunicationPage.js").then((m) => ({ default: m.CommunicationPage })));
const EventOverviewPage = lazy(() => import("./pages/EventOverviewPage.js").then((m) => ({ default: m.EventOverviewPage })));
const ReportsPage = lazy(() => import("./pages/ReportsPage.js").then((m) => ({ default: m.ReportsPage })));
const SetupWizardPage = lazy(() => import("./pages/SetupWizardPage.js").then((m) => ({ default: m.SetupWizardPage })));

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

  // On-demand re-fetch: pages nested under this layout (Settings, Attendees,
  // Requirements, Communication, Import, Check-in) all read `event` from the
  // Outlet context below, but the effect that populates it only re-runs when
  // `eventId` changes — an in-place mutation like archive/unarchive/save on
  // the Settings page otherwise leaves every *other* already-mounted sibling
  // page (and the sidebar) showing the pre-mutation snapshot until a full
  // reload. Settings calls this after such a mutation succeeds so the whole
  // layout reflects the change immediately, without re-fetching on every
  // unrelated in-event navigation.
  const refreshEvent = useCallback(async () => {
    if (!eventId) return;
    try {
      const events = await fetchAdminEvents({ includeArchived: true });
      const found = events.find((e) => e.id === eventId);
      if (found) setEvent(found);
    } catch {
      // Best-effort: the mutation that triggered this already reported its
      // own success/error toast, so a failed background refresh here just
      // keeps showing the last-known-good snapshot instead of surfacing a
      // second, confusing error for a non-critical sync.
    }
  }, [eventId]);

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
  // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally only re-fetches on eventId change; location/navigate are navigation side-effects, not data deps (re-adding them caused blank-shell re-fetch on every in-event nav, fixed in #282)
  }, [eventId]);

  if (error) return <Navigate to="/admin" replace />;
  if (!event) {
    return (
      <div className="shell-loading" role="status">
        <Spinner label="Loading event" />
      </div>
    );
  }

  return <AdminShell event={event} refreshEvent={refreshEvent} />;
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
            <Route element={<SettingsLayout />}>
              <Route index element={<SettingsTabContent />} />
              <Route path="identity">
                <Route index element={<Navigate to="providers" replace />} />
                <Route path="providers" element={<IdentityProvidersPanel />} />
                <Route path="providers/new" element={<IdentityProviderEditor mode="create" />} />
                <Route path="providers/:providerId" element={<IdentityProviderEditor mode="edit" />} />
                <Route path="cloudflare" element={<CfAccessEditor />} />
              </Route>
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
        {/* Catch-all: any unmatched /admin/* (e.g. removed legacy /admin/auth/* URLs)
            redirects to the events picker instead of rendering a blank outlet. */}
        <Route path="*" element={<Navigate to="/admin" replace />} />
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
        <Route element={<EventsListShell />}>
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
            <Suspense
              fallback={
                <div className="shell-loading" role="status">
                  <Spinner label="Loading" />
                </div>
              }
            >
              <StaffRoutes />
            </Suspense>
          </ConnectionStateProvider>
        </AuthProvider>
        <DemoBar />
      </ToastProvider>
    </ErrorBoundary>
  );
}
