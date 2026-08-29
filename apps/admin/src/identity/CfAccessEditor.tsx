import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router";
import { Badge, Button, Card, Input, Notice, Spinner, Switch, Tooltip, useToast } from "@admitto/ui";
import { ApiError, fetchCfAccessSummary, testCfAccess, updateCfAccess } from "../api/client.js";
import { operatorApiErrorMessage } from "../api/operator-api-error.js";
import type { CfAccessSummaryDto } from "../api/types.js";
import { SearchableSelect } from "../components/SearchableSelect.js";
import { useDelayedLoading } from "../hooks/useDelayedLoading.js";
import { useOverscrollBounceGuard } from "../hooks/useOverscrollBounceGuard.js";
import {
  buildCfUpdateBody,
  cfDraftFromSummary,
  emptyCfDraft,
  isCfDraftDirty,
  validateCfDraft,
  type CfAccessDraft,
  type CfAccessFieldErrors,
} from "./cfAccessValidation.js";
import { DiscardUnsavedChangesDialogs } from "./DiscardUnsavedChangesDialogs.js";
import { IdentityModalHeader } from "./IdentityModalHeader.js";
import { IDENTITY_PROVIDERS_ROUTE } from "./routes.js";
import { useUnsavedChangesGuard } from "./useUnsavedChangesGuard.js";

type LoadState = "loading" | "ready" | "error";

/** Session expired mid-fetch: hand off to login with a return path (matches the
 * pattern used across the admin SPA, e.g. IdentityProviderEditor/ReportsPage). */
function redirectToLogin(): void {
  const next = encodeURIComponent(window.location.pathname);
  window.location.assign(`/login?next=${next}`);
}

const CF_ACCESS_FALLTHROUGH_INFO = (
  <Notice variant="info">
    <strong>How staff sign-in works:</strong> When Cloudflare sends a valid Access JWT, Admitto
    trusts it for protected admin paths. When no JWT is present (direct URL, local network, or
    break-glass), Admitto shows the normal email/password login. Local superadmin accounts
    always remain available as a fallback.
  </Notice>
);

type CfAccessEditorFormProps = {
  draft: CfAccessDraft;
  setDraft: Dispatch<SetStateAction<CfAccessDraft>>;
  baseline: CfAccessDraft;
  locks: CfAccessSummaryDto["locks"];
  errors: CfAccessFieldErrors;
  sourceProviders: CfAccessSummaryDto["sourceProviders"];
  saving: boolean;
  testing: boolean;
  dirty: boolean;
  onSubmit: (event: React.FormEvent) => void;
  onCancel: () => void;
  onTest: () => void;
};

/** The "ready" state form, split out of {@link CfAccessEditor} to keep that component's own
 * cognitive complexity down - this owns every field-level conditional (env-locked badges, the
 * disabled source-provider warning, the pre-enable notice) that used to live inline there. */
function CfAccessEditorForm({
  draft,
  setDraft,
  baseline,
  locks,
  errors,
  sourceProviders,
  saving,
  testing,
  dirty,
  onSubmit,
  onCancel,
  onTest,
}: Readonly<CfAccessEditorFormProps>) {
  // Keep a legacy, now-disabled provider visible as a recovery problem, but never offer it as
  // a new selection. SearchableSelect intentionally has no per-option disabled state.
  const enabledSourceProviders = sourceProviders.filter((provider) => provider.enabled);
  const sourceProviderUnavailable =
    Boolean(draft.sourceProviderId) &&
    !enabledSourceProviders.some((provider) => provider.id === draft.sourceProviderId);
  const sourceProviderError =
    errors.sourceProviderId ??
    (sourceProviderUnavailable
      ? "The selected direct identity provider is unavailable. Select an enabled provider before enabling Cloudflare Access."
      : undefined);

  // "Before you enable" warning shows only on the off→on transition — once CF
  // Access is already active (baseline.enabled), the operator is editing an active
  // config, not enabling it, so the pre-enable caution is misleading.
  const enabledWarning =
    draft.enabled && !locks.enabled && !baseline.enabled ? (
      <Notice variant="warning" role="alert">
        <strong>Before you enable:</strong> run <strong>Test connection</strong> with your team
        URL. A wrong application token or team URL can block staff sign-in until you fix the
        values or use a local break-glass account.
      </Notice>
    ) : null;

  const envLockedInfo =
    draft.enabled && locks.enabled ? (
      <Notice variant="info">Cloudflare Access is enabled and locked by environment configuration.</Notice>
    ) : null;

  return (
    <form className="identity-editor cf-editor" onSubmit={onSubmit} noValidate>
      {CF_ACCESS_FALLTHROUGH_INFO}
      {enabledWarning}
      {envLockedInfo}

      <Card
        title="Configuration"
        actions={
          <div className="cf-editor__enabled">
            <Tooltip content="Require a Cloudflare Access JWT for protected admin paths">
              <Switch
                id="cf-access-enabled"
                aria-label="Enabled"
                checked={draft.enabled}
                disabled={locks.enabled}
                onChange={(e) => setDraft((d) => ({ ...d, enabled: e.target.checked }))}
              />
            </Tooltip>
            {locks.enabled && <Badge variant="neutral">Locked by env</Badge>}
          </div>
        }
      >
        <div className="identity-editor__grid">
          <Input
            label="Cloudflare team URL"
            type="url"
            value={draft.teamDomain}
            invalid={Boolean(errors.teamDomain)}
            error={errors.teamDomain}
            disabled={locks.teamDomain}
            hint="Zero Trust → Settings → Custom Pages. Paste the team URL (issuer), not the application hostname. https://<team>.cloudflareaccess.com or a schemeless <team>.cloudflareaccess.com host."
            placeholder="https://yourteam.cloudflareaccess.com"
            onChange={(e) => setDraft((d) => ({ ...d, teamDomain: e.target.value }))}
          />
          {locks.teamDomain && <Badge variant="neutral">Locked by env</Badge>}

          <Input
            label="Application token (AUD)"
            value={draft.audienceRaw}
            invalid={Boolean(errors.audience)}
            error={errors.audience}
            disabled={locks.audience}
            hint="Zero Trust → Access → Applications → your app → Overview → Application Audience (AUD) Tag. One value, or comma-separated for multiple apps."
            placeholder="a1b2c3d4-e5f6-7890-abcd-ef1234567890"
            onChange={(e) => setDraft((d) => ({ ...d, audienceRaw: e.target.value }))}
          />
          {locks.audience && <Badge variant="neutral">Locked by env</Badge>}

          <div className="cf-editor__grid-full">
            <SearchableSelect
              id="cf-access-source-provider"
              label="Direct identity provider"
              value={draft.sourceProviderId}
              options={enabledSourceProviders.map((provider) => ({
                id: provider.id,
                label: provider.displayName,
              }))}
              placeholder="Select the direct OIDC provider"
              searchPlaceholder="Search identity providers"
              emptyLabel="No OIDC identity providers are configured."
              disabled={locks.sourceProviderId}
              invalid={Boolean(sourceProviderError)}
              describedBy={sourceProviderError ? "cf-access-source-provider-error" : undefined}
              hint="Select the direct OIDC provider (usually Authentik) that already owns staff identities. Admitto uses its immutable subject forwarded by Cloudflare, never an e-mail address."
              onChange={(sourceProviderId) => setDraft((d) => ({ ...d, sourceProviderId }))}
            />
            {sourceProviderError && (
              <span id="cf-access-source-provider-error" className="at-error" role="alert">
                {sourceProviderError}
              </span>
            )}
            {locks.sourceProviderId && <Badge variant="neutral">Locked by env</Badge>}
          </div>

          <div className="cf-editor__grid-full">
            <Input
              label="Protected URL paths"
              value={draft.protectedPrefixesRaw}
              invalid={Boolean(errors.protectedPrefixes)}
              error={errors.protectedPrefixes}
              disabled={locks.protectedPrefixes}
              hint="Paths that require a Cloudflare Access JWT. Default covers the admin UI and admin API. Comma-separated (each must start with /)."
              placeholder="/admin, /api/admin"
              onChange={(e) => setDraft((d) => ({ ...d, protectedPrefixesRaw: e.target.value }))}
            />
          </div>
          {locks.protectedPrefixes && <Badge variant="neutral">Locked by env</Badge>}
        </div>
      </Card>

      <div className="identity-editor__actions">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={onTest}
          disabled={testing || saving}
          aria-busy={testing}
        >
          {testing ? "Testing…" : "Test connection"}
        </Button>
        <Button type="submit" variant="primary" disabled={saving || !dirty}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </form>
  );
}

/**
 * Cloudflare Access SPA editor (#266 slice 4). Renders the CF Zero Trust config
 * editor under the StaffShell-consistent Identity sub-tab at
 * /admin/settings/identity/cloudflare. Loads the singleton CF Access config +
 * per-field env locks, lets the operator edit team domain / AUD / protected
 * prefixes, test the team URL's JWKS endpoint, and save (PATCH semantics:
 * omitted fields keep their stored value; env-locked fields stay
 * locked). Mirrors the IdentityProviderEditor dirty-guard + loadTick patterns so a
 * superadmin can't silently drop unsaved edits via an in-app navigation.
 */
export function CfAccessEditor() {
  const navigate = useNavigate();
  const { addToast } = useToast();
  const [draft, setDraft] = useState<CfAccessDraft>(() => emptyCfDraft());
  const [baseline, setBaseline] = useState<CfAccessDraft>(() => emptyCfDraft());
  const [locks, setLocks] = useState<CfAccessSummaryDto["locks"]>({
    enabled: false,
    teamDomain: false,
    audience: false,
    protectedPrefixes: false,
    sourceProviderId: false,
  });
  const [sourceProviders, setSourceProviders] = useState<CfAccessSummaryDto["sourceProviders"]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [errors, setErrors] = useState<CfAccessFieldErrors>({});
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  // Retry tick drives the load effect (mount + Retry button), mirroring the
  // loadTick pattern in IdentityProviderEditor. Each run owns its AbortController
  // and aborts on cleanup so a StrictMode remount and a Retry both re-fetch cleanly.
  const [loadTick, setLoadTick] = useState(0);

  const load = useCallback(async (signal: AbortSignal) => {
    setLoadState((prev) => (prev === "ready" ? prev : "loading"));
    setErrors({});
    try {
      const summary = await fetchCfAccessSummary(signal);
      const next = cfDraftFromSummary(summary);
      setDraft(next);
      setBaseline(next);
      setLocks(summary.locks);
      setSourceProviders(summary.sourceProviders);
      setLoadState("ready");
    } catch (err) {
      if (signal.aborted) return;
      if (err instanceof ApiError && err.status === 401) {
        redirectToLogin();
        return;
      }
      setLoadState("error");
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load, loadTick]);

  const retryLoad = useCallback(() => setLoadTick((n) => n + 1), []);

  const dirty = isCfDraftDirty(draft, baseline);

  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  // Always starts in loadState "loading" - the real form fields don't exist in the DOM
  // until the fetch resolves, so initial focus must be re-attempted once loadState changes.
  const { skipBlockRef, blocker, discardConfirmOpen, setDiscardConfirmOpen, handleCancel } =
    useUnsavedChangesGuard(panelRef, dirty, saving || testing, navigate, loadState);
  const scrollRef = useRef<HTMLDivElement>(null);
  useOverscrollBounceGuard(scrollRef);
  // A fetch that resolves near-instantly (localhost, a warm cache) would
  // otherwise flash the spinner on and off faster than it can register as
  // "loading" — show it only once the fetch has genuinely taken a moment.
  const showLoadingSpinner = useDelayedLoading(loadState === "loading");

  const handleSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      const validation = validateCfDraft(draft);
      setErrors(validation);
      if (Object.keys(validation).length > 0) {
        addToast("Please fix the highlighted fields.", "error");
        return;
      }
      setSaving(true);
      try {
        const refreshed = await updateCfAccess(buildCfUpdateBody(draft, locks));
        const next = cfDraftFromSummary(refreshed);
        setDraft(next);
        setBaseline(next);
        setLocks(refreshed.locks);
        setSourceProviders(refreshed.sourceProviders);
        setErrors({});
        addToast("Cloudflare Access settings saved.", "success");
        skipBlockRef.current = true;
        navigate(IDENTITY_PROVIDERS_ROUTE);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          redirectToLogin();
          return;
        }
        const message = operatorApiErrorMessage(err, "Failed to save settings.");
        addToast(message, "error");
      } finally {
        setSaving(false);
      }
    },
    [draft, locks, addToast, navigate, skipBlockRef],
  );

  // Test probes the team domain's JWKS endpoint. Send the draft team domain when
  // the operator typed one so they can test before saving; the server falls back to
  // the stored value when the field is blank. Available even when the team domain
  // is env-locked — the locked value is seeded into the draft on load, so the
  // operator can still verify an env-managed configuration from the UI.
  const handleTest = useCallback(async () => {
    setTesting(true);
    try {
      const teamDomain = draft.teamDomain.trim();
      const result = await testCfAccess(teamDomain || undefined);
      addToast(
        result.ok ? "Connection verified." : result.error ?? "Connection test failed.",
        result.ok ? "success" : "error",
      );
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        redirectToLogin();
        return;
      }
      const message = operatorApiErrorMessage(err, "Connection test failed.");
      addToast(message, "error");
    } finally {
      setTesting(false);
    }
  }, [draft.teamDomain, addToast]);

  let content: ReactNode;
  if (loadState === "loading") {
    content = showLoadingSpinner ? (
      <output className="identity-editor__loading">
        <Spinner label="Loading Cloudflare Access" />
      </output>
    ) : null;
  } else if (loadState === "error") {
    content = (
      <div className="identity-editor__error">
        <p>Could not load the Cloudflare Access configuration.</p>
        <Button variant="secondary" onClick={retryLoad}>
          Retry
        </Button>
      </div>
    );
  } else {
    content = (
      <CfAccessEditorForm
        draft={draft}
        setDraft={setDraft}
        baseline={baseline}
        locks={locks}
        errors={errors}
        sourceProviders={sourceProviders}
        saving={saving}
        testing={testing}
        dirty={dirty}
        onSubmit={handleSubmit}
        onCancel={handleCancel}
        onTest={handleTest}
      />
    );
  }

  return createPortal(
    <>
      <dialog open className="identity-modal" aria-modal="true" aria-labelledby={titleId}>
        <div className="identity-modal__backdrop" aria-hidden="true" />
        <div ref={panelRef} className="identity-modal__panel identity-modal__panel--wide">
          <div ref={scrollRef} className="identity-modal__scroll at-scroll">
            <IdentityModalHeader
              titleId={titleId}
              title="Cloudflare Access"
              icon={<i className="ti ti-brand-cloudflare" />}
              badge={
                loadState === "ready" && (
                  <>
                    {draft.enabled ? (
                      <Badge variant="ok">Active</Badge>
                    ) : (
                      <Badge variant="neutral">Inactive</Badge>
                    )}
                    {locks.enabled && <Badge variant="warn">Managed by environment</Badge>}
                  </>
                )
              }
              subtitle={
                loadState === "ready" && (
                  <>
                    Require a Cloudflare Zero Trust Access JWT for protected admin paths. Configure
                    your team URL, application audience tag, direct identity provider, and protected
                    prefixes.
                  </>
                )
              }
              onClose={handleCancel}
              closeDisabled={saving || testing}
            />
            {content}
          </div>
        </div>
      </dialog>
      <DiscardUnsavedChangesDialogs
        message="You have unsaved Cloudflare Access changes. They will be lost if you leave this page."
        cancelDialogOpen={discardConfirmOpen}
        onCancelDialogConfirm={() => {
          setDiscardConfirmOpen(false);
          skipBlockRef.current = true;
          navigate(IDENTITY_PROVIDERS_ROUTE);
        }}
        onCancelDialogDismiss={() => setDiscardConfirmOpen(false)}
        blockerDialogOpen={blocker.state === "blocked"}
        onBlockerDialogConfirm={() => {
          skipBlockRef.current = true;
          blocker.proceed?.();
        }}
        onBlockerDialogDismiss={() => blocker.reset?.()}
      />
    </>,
    document.body,
  );
}
