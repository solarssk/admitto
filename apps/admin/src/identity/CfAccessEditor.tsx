import { useCallback, useEffect, useRef, useState } from "react";
import { useBlocker, useLocation, useNavigate } from "react-router-dom";
import type { BlockerFunction } from "react-router";
import { Badge, Button, Card, Input, Spinner, Switch, useToast } from "@admitto/ui";
import { ApiError, fetchCfAccessSummary, testCfAccess, updateCfAccess } from "../api/client.js";
import { operatorApiErrorMessage } from "../api/operator-api-error.js";
import type { CfAccessSummaryDto } from "../api/types.js";
import {
  buildCfUpdateBody,
  cfDraftFromSummary,
  emptyCfDraft,
  isCfDraftDirty,
  validateCfDraft,
  type CfAccessDraft,
  type CfAccessFieldErrors,
} from "./cfAccessValidation.js";
import { IDENTITY_PROVIDERS_ROUTE } from "./routes.js";

type LoadState = "loading" | "ready" | "error";

/** Session expired mid-fetch: hand off to login with a return path (matches the
 * pattern used across the admin SPA, e.g. IdentityProviderEditor/ReportsPage). */
function redirectToLogin(): void {
  const next = encodeURIComponent(window.location.pathname);
  window.location.assign(`/login?next=${next}`);
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
  });
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

  // Router-level dirty guard — same shape as IdentityProviderEditor. The Identity
  // tabs / Settings sidebar / SPA back button are in-app navigations that
  // `beforeunload` doesn't catch. `skipBlockRef` is a one-shot bypass for the
  // programmatic exits (Cancel after confirm / Save); the location effect re-arms
  // it after each completed navigation so the next dirty edit is still guarded.
  const skipBlockRef = useRef(false);
  const location = useLocation();
  useEffect(() => {
    skipBlockRef.current = false;
  }, [location.pathname]);
  const blocker = useBlocker(
    useCallback<BlockerFunction>(
      ({ currentLocation, nextLocation }) => {
        if (skipBlockRef.current) return false;
        if (!dirty) return false;
        return nextLocation.pathname !== currentLocation.pathname;
      },
      [dirty],
    ),
  );
  useEffect(() => {
    if (blocker.state !== "blocked") return;
    if (window.confirm("Discard unsaved changes?")) {
      skipBlockRef.current = true;
      blocker.proceed();
    } else {
      blocker.reset();
    }
  }, [blocker]);

  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  const handleCancel = useCallback(() => {
    if (dirty && !window.confirm("Discard unsaved changes?")) return;
    skipBlockRef.current = true;
    navigate(IDENTITY_PROVIDERS_ROUTE);
  }, [dirty, navigate]);

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
        setErrors({});
        addToast("Cloudflare Access settings saved.", "success");
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
    [draft, locks, addToast],
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

  // "Before you enable" warning shows only on the off→on transition — once CF
  // Access is already active (baseline.enabled), the operator is editing an active
  // config, not enabling it, so the pre-enable caution is misleading.
  const enabledWarning =
    draft.enabled && !locks.enabled && !baseline.enabled ? (
      <div className="cf-editor__warn" role="alert">
        <strong>Before you enable:</strong> run <strong>Test connection</strong> with your team
        URL. A wrong application token or team URL can block staff sign-in until you fix the
        values or use a local break-glass account.
      </div>
    ) : null;

  const envLockedInfo =
    draft.enabled && locks.enabled ? (
      <div className="cf-editor__info">
        Cloudflare Access is enabled and locked by environment configuration.
      </div>
    ) : null;

  const fallthroughInfo = (
    <div className="cf-editor__info">
      <strong>How staff sign-in works:</strong> When Cloudflare sends a valid Access JWT, Admitto
      trusts it for protected admin paths. When no JWT is present (direct URL, local network, or
      break-glass), Admitto shows the normal email/password login. Local superadmin accounts
      always remain available as a fallback.
    </div>
  );

  if (loadState === "loading") {
    return (
      <output className="identity-editor__loading">
        <Spinner label="Loading Cloudflare Access" />
      </output>
    );
  }

  if (loadState === "error") {
    return (
      <Card title="Cloudflare Access">
        <div className="identity-editor__error">
          <p>Couldn't load the Cloudflare Access configuration.</p>
          <Button variant="secondary" onClick={retryLoad}>
            Retry
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <div className="identity-editor__page">
      <div className="identity-editor__header">
        <h2 className="identity-editor__title">Cloudflare Access</h2>
        <p className="identity-editor__subtitle">
          Require a Cloudflare Zero Trust Access JWT for protected admin paths. Configure your
          team URL, application audience tag, and protected prefixes.
        </p>
        <div className="cf-editor__status">
          {draft.enabled ? (
            <Badge variant="ok" dot>Active</Badge>
          ) : (
            <Badge variant="neutral" dot>Inactive</Badge>
          )}
          {locks.enabled && <Badge variant="warn">Managed by environment</Badge>}
        </div>
      </div>

      <form className="identity-editor cf-editor" onSubmit={handleSubmit} noValidate>
        {fallthroughInfo}
        {enabledWarning}
        {envLockedInfo}

        <Card title="Configuration">
          <div className="identity-editor__grid">
            <div className="identity-editor__switch cf-editor__enabled">
              <Switch
                id="cf-access-enabled"
                label="Enable Cloudflare Access for protected admin paths"
                checked={draft.enabled}
                disabled={locks.enabled}
                onChange={(e) => setDraft((d) => ({ ...d, enabled: e.target.checked }))}
              />
              {locks.enabled && <Badge variant="neutral">Locked by env</Badge>}
            </div>

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

          <div className="cf-editor__test">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={handleTest}
              disabled={testing || saving}
              aria-busy={testing}
            >
              {testing ? "Testing…" : "Test connection"}
            </Button>
          </div>
        </Card>

        <div className="identity-editor__actions">
          <Button type="button" variant="ghost" onClick={handleCancel} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={saving}>
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </form>
    </div>
  );
}
