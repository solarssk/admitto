import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Badge, Button, Card, EmptyState, Skeleton, Switch, useToast } from "@admitto/ui";
import {
  ApiError,
  fetchCfAccessSummary,
  fetchIdentityProviders,
  toggleIdentityProvider,
} from "../api/client.js";
import type { CfAccessSummaryDto, IdentityProviderListItem } from "../api/types.js";

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
/** Bridge to the legacy HTML editor until the SPA CF Access editor lands (slice 4, #266). */
const LEGACY_CF_ACCESS_HREF = "/admin/auth/cf-access";

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
}: {
  provider: ProviderRow;
  onToggle: (provider: ProviderRow) => void;
  disabled: boolean;
}) {
  const labelId = `idp-enabled-${provider.id}`;
  return (
    <div className="settings-row identity-provider-row">
      <div className="settings-row__text">
        <strong>{provider.display_name}</strong>
        <p className="identity-provider-row__issuer">{provider.issuer}</p>
      </div>
      <div className="identity-provider-row__actions">
        <Link className="at-btn at-btn--ghost" to={providerEditPath(provider.id)}>
          <span>Edit</span>
        </Link>
        <Switch
          id={labelId}
          label="Enabled"
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
 * providers is delivered in slice 3 (this PR); the CF Access SPA editor lands in
 * slice 4, so until then the CF Manage action bridges to the legacy HTML page.
 */
export function IdentityProvidersPanel() {
  const { addToast } = useToast();
  const [providers, setProviders] = useState<ProviderRow[]>([]);
  const [cf, setCf] = useState<CfAccessSummaryDto | null>(null);
  const [providersState, setProvidersState] = useState<LoadState>("loading");
  const [cfState, setCfState] = useState<LoadState>("loading");
  // Set of provider ids with an in-flight toggle. A Set (not a single scalar) so
  // toggling two different providers back-to-back doesn't re-enable the first
  // row's Switch while its request is still pending, and the finally only clears
  // the matching id.
  const [togglingIds, setTogglingIds] = useState<ReadonlySet<string>>(new Set());
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

  const handleToggle = useCallback(
    async (provider: ProviderRow) => {
      const next = !provider.enabled;
      // Optimistic flip so the switch feels instant.
      setProviders((prev) =>
        prev.map((row) => (row.id === provider.id ? { ...row, enabled: next } : row)),
      );
      setTogglingIds((prev) => new Set(prev).add(provider.id));
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
        const message = err instanceof ApiError ? err.message : "Failed to toggle provider";
        addToast(message, "error");
      } finally {
        setTogglingIds((prev) => {
          const nextSet = new Set(prev);
          nextSet.delete(provider.id);
          return nextSet;
        });
      }
    },
    [addToast, retryProviders],
  );

  return (
    <div className="identity-section__panels">
      <Card
        title="OIDC providers"
        actions={
          <Link className="at-btn at-btn--primary" to={PROVIDER_NEW_PATH}>
            <span>Add provider</span>
          </Link>
        }
      >
        {providersState === "loading" && <ProviderListSkeleton />}
        {providersState === "error" && (
          <EmptyState
            title="Couldn't load providers"
            description="Something went wrong while fetching identity providers."
            action={<Button variant="secondary" onClick={retryProviders}>Retry</Button>}
          />
        )}
        {providersState === "ready" && providers.length === 0 && (
          <EmptyState
            title="No identity providers yet"
            description="Add an OpenID Connect provider to enable single sign-on for your team."
            action={
              <Link className="at-btn at-btn--primary" to={PROVIDER_NEW_PATH}>
                <span>Add provider</span>
              </Link>
            }
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
        {providersState === "ready" && (
          <p className="identity-providers__hint">
            {togglingIds.size > 0 ? "Saving changes…" : "Add or edit a provider to configure OIDC endpoints, claims, and group→role mapping."}
          </p>
        )}
      </Card>

      <Card title="Cloudflare Access">
        {cfState === "loading" && <Skeleton height={56} />}
        {cfState === "error" && (
          <EmptyState
            title="Couldn't load Cloudflare Access"
            description="Something went wrong while fetching the Cloudflare Access configuration."
            action={<Button variant="secondary" onClick={retryCf}>Retry</Button>}
          />
        )}
        {cfState === "ready" && cf && (
          <div className="settings-row cf-access-summary">
            <div className="settings-row__text">
              <strong>
                Cloudflare Zero Trust {cf.enabled ? null : <span className="cf-access-summary__off">(disabled)</span>}
              </strong>
              <p>
                {cf.teamDomain
                  ? `Team domain: ${cf.teamDomain}`
                  : "No team domain configured."}
              </p>
              <div className="cf-access-summary__badges">
                {cf.enabled ? (
                  <Badge variant="ok" dot>Enabled</Badge>
                ) : (
                  <Badge variant="neutral" dot>Disabled</Badge>
                )}
                {cf.locks.enabled && <Badge variant="warn">Managed by environment</Badge>}
              </div>
            </div>
            <a className="at-btn at-btn--secondary" href={LEGACY_CF_ACCESS_HREF}>
              <span>Manage</span>
            </a>
          </div>
        )}
      </Card>
    </div>
  );
}
