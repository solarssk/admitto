import { lazy, Suspense, useCallback, useEffect, useRef, type ReactNode } from "react";
import { Link, useLocation, useParams } from "react-router";
import { Badge, Card, EmptyState, HintLabel, Skeleton, Switch, Tooltip, useToast } from "@admitto/ui";
import {
  fetchCfAccessSummary,
  fetchIdentityProviders,
  toggleIdentityProvider,
} from "../api/client.js";
import { operatorApiErrorMessage } from "../api/operator-api-error.js";
import type { CfAccessSummaryDto, IdentityProviderListItem } from "../api/types.js";
import { RefetchRegion } from "../components/RefetchRegion.js";
import { RefreshWarning } from "../components/RefreshWarning.js";
import { RetryEmptyState } from "../components/RetryEmptyState.js";
import { useDelayedLoading, useLoadingGate } from "../hooks/useDelayedLoading.js";
import { useInFlightIds } from "../hooks/useInFlightIds.js";
import { useListLoad, type ListLoad } from "../hooks/useListLoad.js";
import { useRetryKeepingError } from "../hooks/useRetryKeepingError.js";
import { SLOW_NOTICE_MS, SLOW_NOTICE_TEXT } from "../utils/loading-timing.js";
import { orLoginRedirect } from "./loginRedirect.js";
import { IDENTITY_CLOUDFLARE_ROUTE, IDENTITY_PROVIDERS_ROUTE } from "./routes.js";

// Modal editors are only needed once an operator opens Add/Edit/Manage — keep them
// out of the list's own chunk the same way App.tsx code-split them before these
// routes moved to render inline here.
const IdentityProviderEditor = lazy(() =>
  import("./IdentityProviderEditor.js").then((m) => ({ default: m.IdentityProviderEditor })),
);
const CfAccessEditor = lazy(() =>
  import("./CfAccessEditor.js").then((m) => ({ default: m.CfAccessEditor })),
);

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

/** Row shape is 1:1 with the API list DTO. */
type ProviderRow = IdentityProviderListItem;

function providerEditPath(id: string): string {
  return `/admin/settings/identity/providers/${encodeURIComponent(id)}`;
}

/** The two reads of this screen: module level, so each is one stable request (a 401 hands over to the login page). */
const fetchProviderRows = orLoginRedirect(async (signal: AbortSignal) => (await fetchIdentityProviders(signal)).providers);
const fetchCfSummary = orLoginRedirect((signal: AbortSignal) => fetchCfAccessSummary(signal));

/**
 * How one card of this screen is on screen: the placeholder of its first load (held for the first 200ms, "Taking longer
 * than usual" after 8 seconds), the error with a Retry that stays on screen, busy, until the answer is in, or neither.
 */
function useCardLoad<T>(list: ListLoad<T>) {
  const failure = useRetryKeepingError(list.error, list.reload);
  const gate = useLoadingGate(list.loading && !failure.running);
  const slow = useDelayedLoading(list.loading && !failure.running, SLOW_NOTICE_MS);
  return { gate, slow, failure };
}

/** A card's placeholder: rows of the height of the real ones, in a status region named after what is loading. */
function CardSkeleton({ label, held, slow, rows, rowHeight }: Readonly<{ label: string; held: boolean; slow: boolean; rows: number; rowHeight: number }>) {
  return (
    <output aria-label={label} className={held ? "identity-providers__skeleton at-loading-hold" : "identity-providers__skeleton"}>
      {Array.from({ length: rows }, (_, row) => (
        <Skeleton key={row} height={rowHeight} />
      ))}
      {slow ? <span className="at-hint" style={{ textAlign: "center", color: "var(--text-secondary)" }}>{SLOW_NOTICE_TEXT}</span> : null}
    </output>
  );
}

const PROVIDER_NEW_PATH = `${IDENTITY_PROVIDERS_ROUTE}/new`;

const IDENTITY_PROVIDERS_HINT =
  "Lets staff sign in with an external identity provider instead of email and password.";
const CLOUDFLARE_ACCESS_HINT =
  "Shows whether Cloudflare Access is protecting this deployment as an extra login layer.";

function cfStatusBadge(cf: CfAccessSummaryDto): ReactNode {
  return cf.enabled ? <Badge variant="ok">Active</Badge> : <Badge variant="neutral">Inactive</Badge>;
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
          // Off while its own toggle is in flight, but still focusable: a switch that turns `disabled` under the
          // keyboard that has just flipped it would drop the focus on <body>.
          aria-disabled={disabled || undefined}
          aria-busy={disabled || undefined}
          onChange={() => {
            if (!disabled) onToggle(provider);
          }}
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
  // Ids with an in-flight toggle, so toggling two different providers
  // back-to-back doesn't re-enable the first row's Switch while its request
  // is still pending.
  const { ids: togglingIds, start: startToggling, finish: finishToggling } = useInFlightIds();

  const providers = useListLoad<ProviderRow[]>({ fetcher: fetchProviderRows, fallback: "Could not load identity providers." });
  const cfLoad = useListLoad<CfAccessSummaryDto>({
    fetcher: fetchCfSummary,
    fallback: "Could not load the Cloudflare Access configuration.",
  });
  const providersCard = useCardLoad(providers);
  const cfCard = useCardLoad(cfLoad);
  const providerRows = providers.data ?? [];
  const cf = cfLoad.data;
  const { reload: reloadProviders, update: updateProviders } = providers;
  const { reload: reloadCf } = cfLoad;

  // The list no longer unmounts when a modal route is visited (unlike a full page
  // navigation), so refresh both lists ourselves once a modal closes back to the
  // bare providers route — covers create/edit/CF saves without threading an
  // onSaved callback through both editors.
  const modalWasOpenRef = useRef(modal.kind !== "none");
  useEffect(() => {
    const isOpen = modal.kind !== "none";
    if (modalWasOpenRef.current && !isOpen) {
      void reloadProviders();
      void reloadCf();
    }
    modalWasOpenRef.current = isOpen;
  }, [modal.kind, reloadProviders, reloadCf]);

  const handleToggle = useCallback(
    async (provider: ProviderRow) => {
      const next = !provider.enabled;
      // Optimistic flip so the switch feels instant.
      updateProviders((rows) => rows.map((row) => (row.id === provider.id ? { ...row, enabled: next } : row)));
      startToggling(provider.id);
      try {
        const result = await toggleIdentityProvider(provider.id);
        updateProviders((rows) => rows.map((row) => (row.id === provider.id ? { ...row, enabled: result.enabled } : row)));
        addToast(
          result.enabled ? "Provider enabled." : "Provider disabled.",
          result.enabled ? "success" : "info",
        );
      } catch (err) {
        // Reconcile with the server: a 409 toggle_race (or any failure) means the
        // optimistic flip may not match the persisted state, so refetch the list
        // instead of reverting to a stale closure value. The page cannot tell what the server holds, so a refetch
        // that fails too replaces the rows (which may show a flip the server never accepted) with the error.
        void reloadProviders({ keepRowsOnFailure: false });
        const message = operatorApiErrorMessage(err, "Failed to toggle provider");
        addToast(message, "error");
      } finally {
        finishToggling(provider.id);
      }
    },
    [addToast, reloadProviders, updateProviders, startToggling, finishToggling],
  );

  return (
    // A labelled tab panel like the in-page Settings tabs, so the focus of a Retry that works goes to it (a browser
    // would drop it on <body>) and a screen reader hears where it is.
    <div className="settings-sections" role="tabpanel" aria-label="Identity">
      <Card
        title={<HintLabel hint={IDENTITY_PROVIDERS_HINT}>Identity providers</HintLabel>}
        actions={
          <Link className="at-btn at-btn--primary at-btn--sm" to={PROVIDER_NEW_PATH}>
            <span>Add provider</span>
          </Link>
        }
      >
        {!providersCard.gate.showContent && (
          <CardSkeleton label="Loading identity providers" held={!providersCard.gate.showIndicator} slow={providersCard.slow} rows={2} rowHeight={53} />
        )}
        {providersCard.gate.showContent && providersCard.failure.error && (
          <RetryEmptyState
            title="Could not load providers"
            retryLabel="Retry loading providers"
            message={providersCard.failure.error}
            retrying={providersCard.failure.retrying}
            onRetry={providersCard.failure.retry}
          />
        )}
        {providersCard.gate.showContent && !providersCard.failure.error && providers.data !== null && (
          <RefetchRegion refreshing={providers.refreshing} label="Loading identity providers">
            {providerRows.length === 0 ? (
              <EmptyState
                icon={<i className="ti ti-shield-lock" />}
                title="No identity providers yet"
                description="Add an identity provider to enable single sign-on for your team."
              />
            ) : (
              <div className="identity-providers__list">
                {providerRows.map((provider) => (
                  <ProviderRowItem
                    key={provider.id}
                    provider={provider}
                    onToggle={(provider) => void handleToggle(provider)}
                    disabled={togglingIds.has(provider.id)}
                  />
                ))}
              </div>
            )}
          </RefetchRegion>
        )}
        {providers.refreshError && <RefreshWarning message={providers.refreshError} onRetry={providers.reload} />}
      </Card>

      <Card
        title={<HintLabel hint={CLOUDFLARE_ACCESS_HINT}>Cloudflare Access</HintLabel>}
        actions={cfCard.gate.showContent && !cfCard.failure.error && cf ? cfStatusBadge(cf) : undefined}
      >
        {!cfCard.gate.showContent && (
          <CardSkeleton label="Loading Cloudflare Access" held={!cfCard.gate.showIndicator} slow={cfCard.slow} rows={1} rowHeight={45} />
        )}
        {cfCard.gate.showContent && cfCard.failure.error && (
          <RetryEmptyState
            title="Could not load Cloudflare Access"
            retryLabel="Retry loading Cloudflare Access"
            message={cfCard.failure.error}
            retrying={cfCard.failure.retrying}
            onRetry={cfCard.failure.retry}
          />
        )}
        {cfCard.gate.showContent && !cfCard.failure.error && cf && (
          <RefetchRegion refreshing={cfLoad.refreshing} label="Loading Cloudflare Access">
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
          </RefetchRegion>
        )}
        {cfLoad.refreshError && <RefreshWarning message={cfLoad.refreshError} onRetry={cfLoad.reload} />}
      </Card>

      <Suspense fallback={null}>
        {modal.kind === "create" && <IdentityProviderEditor mode="create" />}
        {modal.kind === "edit" && <IdentityProviderEditor mode="edit" providerId={modal.providerId} />}
        {modal.kind === "cloudflare" && <CfAccessEditor />}
      </Suspense>
    </div>
  );
}
