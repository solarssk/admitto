import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { Badge, Button, Card, EmptyState, Skeleton, Switch, Tooltip, useToast } from "@admitto/ui";
import {
  ApiError,
  fetchCfAccessSummary,
  fetchIdentityProviders,
  toggleIdentityProvider,
} from "../api/client.js";
import { operatorApiErrorMessage } from "../api/operator-api-error.js";
import type { CfAccessSummaryDto, IdentityProviderListItem } from "../api/types.js";
import { useDelayedLoading } from "../hooks/useDelayedLoading.js";
import { useInFlightIds } from "../hooks/useInFlightIds.js";
import { CfAccessEditor } from "./CfAccessEditor.js";
import { IdentityProviderEditor } from "./IdentityProviderEditor.js";
import { IDENTITY_CLOUDFLARE_ROUTE, IDENTITY_PROVIDERS_ROUTE } from "./routes.js";

type Modal =
  | { kind: "none" }
  | { kind: "create" }
  | { kind: "edit"; providerId: string }
  | { kind: "cloudflare" };

/** Derive which modal (if any) sits on top of the list from the matched route —
 * `providers/new`, `providers/:providerId`, and `cloudflare` all render this same
 * panel so the list never unmounts while a modal is open on top of it. */
function resolveModal(pathname: string, providerId: string | undefined): Modal {
  if (pathname === `${IDENTITY_PROVIDERS_ROUTE}/new`) return { kind: "create" };
  if (providerId) return { kind: "edit", providerId };
  if (pathname === IDENTITY_CLOUDFLARE_ROUTE) return { kind: "cloudflare" };
  return { kind: "none" };
}

type LoadState = "loading" | "ready" | "error";
/** Row shape is 1:1 with the API list DTO. */
type ProviderRow = IdentityProviderListItem;

/** Session expired mid-fetch: hand off to login with a return path (matches the
 * pattern used across the admin SPA, e.g. ReportsPage/AttendeesPage). */
function redirectToLogin(): void {
  const next = encodeURIComponent(window.location.pathname);
  window.location.assign(`/login?next=${next}`);
}

function providerEditPath(id: string): string {
  return `/admin/settings/identity/providers/${encodeURIComponent(id)}`;
}

const PROVIDER_NEW_PATH = "/admin/settings/identity/providers/new";

function cfStatusBadge(cf: CfAccessSummaryDto): ReactNode {
  return cf.enabled ? <Badge variant="ok">Active</Badge> : <Badge variant="neutral">Inactive</Badge>;
}

function ProviderListSkeleton() {
  return (
    <div className="identity-providers__skeleton" aria-hidden="true">
      <Skeleton height={64} />
      <Skeleton height={64} />
    </div>
  );
}

function ProviderRowItem({
  provider,
  onToggle,
  disabled,
}: Readonly<{
  provider: ProviderRow;
  onToggle: (provider: ProviderRow) => void;
  disabled: boolean;
}>) {
  const labelId = `idp-enabled-${provider.id}`;
  return (
    <div className="settings-row identity-provider-row">
      <div className="identity-row__main">
        <Tooltip content="OpenID Connect">
          <div className="identity-row-icon" aria-hidden="true">
            <i className="ti ti-shield-lock" />
          </div>
        </Tooltip>
        <div className="settings-row__text">
          <strong>{provider.display_name}</strong>
          <p className="identity-provider-row__issuer">{provider.issuer}</p>
        </div>
      </div>
      <div className="identity-provider-row__actions">
        <Link className="at-btn at-btn--ghost" to={providerEditPath(provider.id)}>
          <span>Edit</span>
        </Link>
        <Switch
          id={labelId}
          aria-label={`${provider.display_name} enabled`}
          checked={provider.enabled}
          disabled={disabled}
          aria-busy={disabled}
          onChange={() => onToggle(provider)}
        />
      </div>
    </div>
  );
}

/**
 * Identity overview — Providers list (OIDC) + Cloudflare Access summary card.
 * Reachable at /admin/settings/identity/providers. The SPA editor for individual
 * providers lives at providers/new | providers/:id; the CF Access SPA editor lives
 * at /admin/settings/identity/cloudflare (slice 4).
 */
export function IdentityProvidersPanel() {
  const { addToast } = useToast();
  const location = useLocation();
  const params = useParams<{ providerId?: string }>();
  const modal = resolveModal(location.pathname, params.providerId);
  const [providers, setProviders] = useState<ProviderRow[]>([]);
  const [cf, setCf] = useState<CfAccessSummaryDto | null>(null);
  const [providersState, setProvidersState] = useState<LoadState>("loading");
  const [cfState, setCfState] = useState<LoadState>("loading");
  // Ids with an in-flight toggle, so toggling two different providers
  // back-to-back doesn't re-enable the first row's Switch while its request
  // is still pending.
  const { ids: togglingIds, start: startToggling, finish: finishToggling } = useInFlightIds();
  // Retry ticks drive the load effects (mount + Retry button). Each effect owns its
  // AbortController and aborts on cleanup, so a React StrictMode remount and a Retry
  // both re-fetch cleanly without leaking in-flight requests or getting stuck on a
  // one-shot ref.
  const [providersRetry, setProvidersRetry] = useState(0);
  const [cfRetry, setCfRetry] = useState(0);

  const loadProviders = useCallback(async (signal: AbortSignal) => {
    setProvidersState((prev) => (prev === "ready" ? prev : "loading"));
    try {
      const data = await fetchIdentityProviders(signal);
      setProviders(data.providers);
      setProvidersState("ready");
    } catch (err) {
      if (signal.aborted) return;
      if (err instanceof ApiError && err.status === 401) {
        redirectToLogin();
        return;
      }
      setProvidersState("error");
    }
  }, []);

  const loadCf = useCallback(async (signal: AbortSignal) => {
    setCfState((prev) => (prev === "ready" ? prev : "loading"));
    try {
      setCf(await fetchCfAccessSummary(signal));
      setCfState("ready");
    } catch (err) {
      if (signal.aborted) return;
      if (err instanceof ApiError && err.status === 401) {
        redirectToLogin();
        return;
      }
      setCfState("error");
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadProviders(controller.signal);
    return () => controller.abort();
  }, [loadProviders, providersRetry]);

  useEffect(() => {
    const controller = new AbortController();
    void loadCf(controller.signal);
    return () => controller.abort();
  }, [loadCf, cfRetry]);

  const retryProviders = useCallback(() => setProvidersRetry((n) => n + 1), []);
  const retryCf = useCallback(() => setCfRetry((n) => n + 1), []);

  // A fetch that resolves near-instantly (localhost, a warm cache) would
  // otherwise flash the skeleton on and off faster than it can register as
  // "loading" — show it only once the fetch has genuinely taken a moment.
  const showProvidersSkeleton = useDelayedLoading(providersState === "loading");
  const showCfSkeleton = useDelayedLoading(cfState === "loading");

  // The list no longer unmounts when a modal route is visited (unlike a full page
  // navigation), so refresh both lists ourselves once a modal closes back to the
  // bare providers route — covers create/edit/CF saves without threading an
  // onSaved callback through both editors.
  const modalWasOpenRef = useRef(modal.kind !== "none");
  useEffect(() => {
    const isOpen = modal.kind !== "none";
    if (modalWasOpenRef.current && !isOpen) {
      retryProviders();
      retryCf();
    }
    modalWasOpenRef.current = isOpen;
  }, [modal.kind, retryProviders, retryCf]);

  const handleToggle = useCallback(
    async (provider: ProviderRow) => {
      const next = !provider.enabled;
      // Optimistic flip so the switch feels instant.
      setProviders((prev) =>
        prev.map((row) => (row.id === provider.id ? { ...row, enabled: next } : row)),
      );
      startToggling(provider.id);
      try {
        const result = await toggleIdentityProvider(provider.id);
        setProviders((prev) =>
          prev.map((row) => (row.id === provider.id ? { ...row, enabled: result.enabled } : row)),
        );
        addToast(
          result.enabled ? "Provider enabled." : "Provider disabled.",
          result.enabled ? "success" : "info",
        );
      } catch (err) {
        // Reconcile with the server: a 409 toggle_race (or any failure) means the
        // optimistic flip may not match the persisted state, so refetch the list
        // instead of reverting to a stale closure value.
        retryProviders();
        const message = operatorApiErrorMessage(err, "Failed to toggle provider");
        addToast(message, "error");
      } finally {
        finishToggling(provider.id);
      }
    },
    [addToast, retryProviders, startToggling, finishToggling],
  );

  return (
    <div className="settings-sections">
      <Card
        title="Identity providers"
        actions={
          <Link className="at-btn at-btn--primary at-btn--sm" to={PROVIDER_NEW_PATH}>
            <span>Add provider</span>
          </Link>
        }
      >
        {providersState === "loading" && showProvidersSkeleton && <ProviderListSkeleton />}
        {providersState === "error" && (
          <EmptyState
            title="Couldn't load providers"
            description="Something went wrong while fetching identity providers."
            action={<Button variant="secondary" onClick={retryProviders}>Retry</Button>}
          />
        )}
        {providersState === "ready" && providers.length === 0 && (
          <EmptyState
            icon={<i className="ti ti-shield-lock" />}
            title="No identity providers yet"
            description="Add an identity provider to enable single sign-on for your team."
          />
        )}
        {providersState === "ready" && providers.length > 0 && (
          <div className="identity-providers__list">
            {providers.map((provider) => (
              <ProviderRowItem
                key={provider.id}
                provider={provider}
                onToggle={handleToggle}
                disabled={togglingIds.has(provider.id)}
              />
            ))}
          </div>
        )}
      </Card>

      <Card
        title="Cloudflare Access"
        actions={cfState === "ready" && cf ? cfStatusBadge(cf) : undefined}
      >
        {cfState === "loading" && showCfSkeleton && <Skeleton height={56} />}
        {cfState === "error" && (
          <EmptyState
            title="Couldn't load Cloudflare Access"
            description="Something went wrong while fetching the Cloudflare Access configuration."
            action={<Button variant="secondary" onClick={retryCf}>Retry</Button>}
          />
        )}
        {cfState === "ready" && cf && (
          <div className="settings-row cf-access-summary">
            <div className="identity-row__main">
              <div className="identity-row-icon" aria-hidden="true">
                <i className="ti ti-brand-cloudflare" />
              </div>
              <div className="cf-access-summary__text">
                <strong>Cloudflare Zero Trust</strong>
                <p>
                  {cf.teamDomain
                    ? `Team domain: ${cf.teamDomain}`
                    : "No team domain configured."}
                </p>
                {cf.locks.enabled && (
                  <div className="cf-access-summary__badges">
                    <Badge variant="warn">Managed by environment</Badge>
                  </div>
                )}
              </div>
            </div>
            <Link className="at-btn at-btn--secondary" to={IDENTITY_CLOUDFLARE_ROUTE}>
              <span>Manage</span>
            </Link>
          </div>
        )}
      </Card>

      {modal.kind === "create" && <IdentityProviderEditor mode="create" />}
      {modal.kind === "edit" && <IdentityProviderEditor mode="edit" providerId={modal.providerId} />}
      {modal.kind === "cloudflare" && <CfAccessEditor />}
    </div>
  );
}
