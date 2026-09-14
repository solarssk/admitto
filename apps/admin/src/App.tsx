import { Suspense, lazy, useCallback, useEffect, useRef, useState, type ComponentType } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate, useParams } from "react-router";
import { Spinner, ToastProvider } from "@admitto/ui";
import { AdminGuard, AuthenticatedGuard, OperatorGuard, SuperadminGuard } from "./auth/RoleRouter.js";
import { OperatorDeviceGate } from "./auth/OperatorDeviceGate.js";
import { AuthProvider, useAuth } from "./auth/AuthProvider.js";
import { isSuperadmin } from "./auth/capabilities.js";
import { ConnectionStateProvider } from "./connection/ConnectionStateProvider.js";
import { ErrorBoundary } from "./components/ErrorBoundary.js";
import { AdminShell } from "./layouts/AdminShell.js";
import { EventsListShell } from "./layouts/EventsListShell.js";
import { InstanceSettingsShell } from "./layouts/InstanceSettingsShell.js";
import { SettingsLayout } from "./layouts/SettingsLayout.js";
import { OperatorShell } from "./layouts/OperatorShell.js";
import { EventsPickerPage } from "./pages/EventsPickerPage.js";
import { PlaceholderPage } from "./pages/PlaceholderPage.js";
import { ApiError, fetchAdminEvent } from "./api/client.js";
import type { EventDto } from "./api/types.js";

// Route-level code-splitting: each page below loads on demand so the initial
// bundle stays under Vite's 500 kB chunk warning. Guards, providers, and
// shells stay static — they render on every path. React Router wraps
// navigations in startTransition, so an in-app navigation keeps the current
// view while the chunk loads; only a cold load of a lazy route shows the
// Suspense fallback.
const loadSettingsTabContent = () => import("./pages/SettingsPage.js").then((m) => ({ default: m.SettingsTabContent }));
const loadIdentityProvidersPanel = () => import("./identity/IdentityProvidersPanel.js").then((m) => ({ default: m.IdentityProvidersPanel }));
const loadUsersPage = () => import("./pages/UsersPage.js").then((m) => ({ default: m.UsersPage }));
const loadAccountLayout = () => import("./account/AccountLayout.js").then((m) => ({ default: m.AccountLayout }));
const loadCheckInEntryPage = () => import("./pages/CheckInEntryPage.js").then((m) => ({ default: m.CheckInEntryPage }));
const loadCheckInPage = () => import("./pages/CheckInPage.js").then((m) => ({ default: m.CheckInPage }));
const loadAdminCheckInRoute = () => import("./pages/AdminCheckInRoute.js").then((m) => ({ default: m.AdminCheckInRoute }));
const loadAttendeesPage = () => import("./pages/AttendeesPage.js").then((m) => ({ default: m.AttendeesPage }));
const loadAttendeeDetailPage = () => import("./pages/AttendeeDetailPage.js").then((m) => ({ default: m.AttendeeDetailPage }));
const loadEventSettingsPage = () => import("./pages/EventSettingsPage.js").then((m) => ({ default: m.EventSettingsPage }));
const loadImportPage = () => import("./pages/ImportPage.js").then((m) => ({ default: m.ImportPage }));
const loadRequirementsPage = () => import("./pages/RequirementsPage.js").then((m) => ({ default: m.RequirementsPage }));
const loadCommunicationPage = () => import("./pages/CommunicationPage.js").then((m) => ({ default: m.CommunicationPage }));
const loadEventOverviewPage = () => import("./pages/EventOverviewPage.js").then((m) => ({ default: m.EventOverviewPage }));
const loadReportsPage = () => import("./pages/ReportsPage.js").then((m) => ({ default: m.ReportsPage }));
const loadSetupWizardPage = () => import("./pages/SetupWizardPage.js").then((m) => ({ default: m.SetupWizardPage }));

const SettingsTabContent = lazy(loadSettingsTabContent);
const IdentityProvidersPanel = lazy(loadIdentityProvidersPanel);
const UsersPage = lazy(loadUsersPage);
const AccountLayout = lazy(loadAccountLayout);
const CheckInEntryPage = lazy(loadCheckInEntryPage);
const CheckInPage = lazy(loadCheckInPage);
const AdminCheckInRoute = lazy(loadAdminCheckInRoute);
const AttendeesPage = lazy(loadAttendeesPage);
const AttendeeDetailPage = lazy(loadAttendeeDetailPage);
const EventSettingsPage = lazy(loadEventSettingsPage);
const ImportPage = lazy(loadImportPage);
const RequirementsPage = lazy(loadRequirementsPage);
const CommunicationPage = lazy(loadCommunicationPage);
const EventOverviewPage = lazy(loadEventOverviewPage);
const ReportsPage = lazy(loadReportsPage);
const SetupWizardPage = lazy(loadSetupWizardPage);

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

/** Maps a subset of PLACEHOLDER_ROUTES paths to their real page component.
 * Paths absent here (approval, wallet, fulfilment, thank-you) fall back to
 * PlaceholderPage in the route map below. */
const EVENT_ROUTE_COMPONENTS: Partial<Record<(typeof PLACEHOLDER_ROUTES)[number]["path"], ComponentType>> = {
  overview: EventOverviewPage,
  checkin: AdminCheckInRoute,
  attendees: AttendeesPage,
  requirements: RequirementsPage,
  communication: CommunicationPage,
  reports: ReportsPage,
};

// A deep link already identifies its initial route. Start loading that route's
// code while EventLayout resolves the event instead of making the route chunk
// wait for that request to finish.
const EVENT_ROUTE_LOADERS: Partial<Record<string, () => Promise<unknown>>> = {
  overview: loadEventOverviewPage,
  attendees: loadAttendeesPage,
  "attendees/import": loadImportPage,
  checkin: loadAdminCheckInRoute,
  communication: loadCommunicationPage,
  reports: loadReportsPage,
  requirements: loadRequirementsPage,
  settings: loadEventSettingsPage,
};

function preloadEventRoute(pathname: string, eventId: string | undefined): void {
  if (!eventId) return;
  const prefix = `/admin/events/${encodeURIComponent(eventId)}/`;
  const routePath = pathname.startsWith(prefix) ? pathname.slice(prefix.length) : undefined;
  if (!routePath) return;

  // Resolve static nested paths before the dynamic attendee detail route so
  // /attendees/import starts its own chunk, not the attendees-list chunk.
  const directLoad = EVENT_ROUTE_LOADERS[routePath];
  const attendeeDetail = routePath.match(/^attendees\/[^/]+$/);
  const load = directLoad ?? (attendeeDetail ? loadAttendeeDetailPage : undefined);
  if (load) void load();
}

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
      setEvent(await fetchAdminEvent(eventId));
    } catch {
      // Best-effort: the mutation that triggered this already reported its
      // own success/error toast, so a failed background refresh here just
      // keeps showing the last-known-good snapshot instead of surfacing a
      // second, confusing error for a non-critical sync.
    }
  }, [eventId]);

  useEffect(() => {
    preloadEventRoute(location.pathname, eventId);
  }, [eventId, location.pathname]);

  useEffect(() => {
    const fromState = navStateEventRef.current;
    setEvent(fromState);
    setError(false);
    if (fromState) {
      // One-shot: strip the event from this history entry's state once
      // consumed. The event endpoint re-scopes org-admin access on every
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
        const found = await fetchAdminEvent(eventId!);
        if (cancelled) return;
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
      <output className="shell-loading">
        <Spinner label="Loading event" />
      </output>
    );
  }

  return <AdminShell event={event} refreshEvent={refreshEvent} />;
}

export function StaffRoutes() {
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
                <Route path="providers/new" element={<IdentityProvidersPanel />} />
                <Route path="providers/:providerId" element={<IdentityProvidersPanel />} />
                <Route path="cloudflare" element={<IdentityProvidersPanel />} />
              </Route>
            </Route>
          </Route>
        </Route>
        <Route path="events/:eventId" element={<EventLayout />}>
          <Route index element={<Navigate to="overview" replace />} />
          {PLACEHOLDER_ROUTES.map((r) => {
            const Component = EVENT_ROUTE_COMPONENTS[r.path];
            return (
              <Route
                key={r.path}
                path={r.path}
                element={Component ? <Component /> : <PlaceholderPage title={r.title} />}
              />
            );
          })}
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
          <ConnectionStateProvider initiallyConnected>
            <Suspense
              fallback={
                <output className="shell-loading">
                  <Spinner label="Loading" />
                </output>
              }
            >
              <StaffRoutes />
            </Suspense>
          </ConnectionStateProvider>
        </AuthProvider>
      </ToastProvider>
    </ErrorBoundary>
  );
}
