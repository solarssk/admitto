import { useCallback, useEffect, useRef, useState } from "react";
import { useBlocker, useLocation, useNavigate, useParams } from "react-router-dom";
import type { BlockerFunction } from "react-router";
import { Button, Card, Input, Spinner, Switch, useToast } from "@admitto/ui";
import {
  ApiError,
  createIdentityProvider,
  fetchIdentityProvider,
  updateIdentityProvider,
} from "../api/client.js";
import type { ProviderDetailDto, ProviderRequestBody } from "../api/types.js";
import {
  emptyProviderDraft,
  isDraftDirty,
  validateProviderDraft,
  type EditorMode,
  type FieldErrors,
  type ProviderDraft,
} from "./identityProviderValidation.js";
import { IDENTITY_PROVIDERS_ROUTE } from "./routes.js";

interface IdentityProviderEditorProps {
  mode: EditorMode;
  /** Provider id for edit mode; when omitted in edit mode, falls back to the
   * `:providerId` route param so the routed element can stay prop-less. */
  providerId?: string;
}

type LoadState = "loading" | "ready" | "error" | "not_found";

/** Mappings carried through unchanged in slice 3a; the repeater lands in slice 3b (#266). */
function mappingsFromDetail(detail: ProviderDetailDto): ProviderRequestBody["mappings"] {
  return detail.mappings.map((m) => ({
    group: m.group,
    role: m.role,
    scope_type: m.scope_type,
    scope_id: m.scope_id || null,
  }));
}

function draftFromDetail(detail: ProviderDetailDto): ProviderDraft {
  return {
    display_name: detail.display_name,
    issuer: detail.issuer,
    client_id: detail.client_id,
    // Secret is write-only; never loaded back. Edit keeps the stored secret unless
    // the operator types a new one (client_secret_touched stays false until then).
    client_secret: "",
    client_secret_touched: false,
    authorization_endpoint: detail.authorization_endpoint,
    token_endpoint: detail.token_endpoint,
    jwks_uri: detail.jwks_uri,
    userinfo_endpoint: detail.userinfo_endpoint ?? "",
    claim_email: detail.claim_email,
    claim_name: detail.claim_name,
    claim_groups: detail.claim_groups,
    enabled: detail.enabled,
    login_button_label: detail.login_button_label ?? "",
  };
}

function buildSaveBody(
  draft: ProviderDraft,
  mode: EditorMode,
  mappings: ProviderRequestBody["mappings"],
): ProviderRequestBody {
  const body: ProviderRequestBody = {
    display_name: draft.display_name.trim(),
    issuer: draft.issuer.trim(),
    client_id: draft.client_id.trim(),
    authorization_endpoint: draft.authorization_endpoint.trim(),
    token_endpoint: draft.token_endpoint.trim(),
    jwks_uri: draft.jwks_uri.trim(),
    userinfo_endpoint: draft.userinfo_endpoint.trim(),
    claim_email: draft.claim_email.trim(),
    claim_name: draft.claim_name.trim(),
    claim_groups: draft.claim_groups.trim(),
    enabled: draft.enabled,
    // Empty label clears to the product default; a string sets it.
    login_button_label: draft.login_button_label.trim() || null,
    mappings,
  };
  // Send the secret only when it's actually being (re)set: always on create,
  // and on edit only when the operator typed a non-empty value. A touched-then
  // cleared field means "keep the stored secret", so we must not send an empty
  // string (the server treats present-but-empty as an overwrite).
  if (mode === "create" || (draft.client_secret_touched && draft.client_secret.trim().length > 0)) {
    body.client_secret = draft.client_secret;
  }
  return body;
}

function setField<K extends keyof ProviderDraft>(
  draft: ProviderDraft,
  key: K,
  value: ProviderDraft[K],
): ProviderDraft {
  const next = { ...draft, [key]: value };
  if (key === "client_secret") {
    next.client_secret_touched = true;
  }
  return next;
}

/**
 * OIDC identity provider editor — slice 3a (#266). Covers Basics, Endpoints,
 * Claims, and the SSO login button label. The group→role mapping repeater,
 * Discover/Test actions, and the live SSO button preview land in slice 3b.
 * Create mode POSTs a new provider; edit mode loads by id and PUTs the full form
 * (mappings are sent back unchanged until the repeater ships).
 */
export function IdentityProviderEditor({ mode, providerId }: IdentityProviderEditorProps) {
  const navigate = useNavigate();
  const { addToast } = useToast();
  const routeParams = useParams();
  const resolvedProviderId = providerId ?? (mode === "edit" ? routeParams.providerId : undefined);
  const [draft, setDraft] = useState<ProviderDraft>(() => emptyProviderDraft());
  const [baseline, setBaseline] = useState<ProviderDraft>(() => emptyProviderDraft());
  const [mappings, setMappings] = useState<ProviderRequestBody["mappings"]>([]);
  const [loadState, setLoadState] = useState<LoadState>(mode === "edit" ? "loading" : "ready");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saving, setSaving] = useState(false);
  const [hasSecret, setHasSecret] = useState(false);

  /** Session expired mid-fetch: hand off to login with a return path (matches the
   * pattern used across the admin SPA, e.g. IdentityProvidersPanel/ReportsPage). */
  function redirectToLogin(): void {
    const next = encodeURIComponent(window.location.pathname);
    window.location.assign(`/login?next=${next}`);
  }

  const load = useCallback(
    async (signal: AbortSignal) => {
      if (mode !== "edit" || !resolvedProviderId) return;
      setLoadState("loading");
      try {
        const detail = await fetchIdentityProvider(resolvedProviderId, signal);
        const nextDraft = draftFromDetail(detail);
        setDraft(nextDraft);
        setBaseline(nextDraft);
        setMappings(mappingsFromDetail(detail));
        setHasSecret(detail.has_client_secret);
        setLoadState("ready");
      } catch (err) {
        if (signal.aborted) return;
        if (err instanceof ApiError && err.status === 404) {
          setLoadState("not_found");
          return;
        }
        if (err instanceof ApiError && err.status === 401) {
          redirectToLogin();
          return;
        }
        setLoadState("error");
      }
    },
    [mode, resolvedProviderId],
  );

  // Re-fetch whenever the resolved provider id changes (deep link, or in-app nav
  // from one provider's edit URL to another). No one-shot ref: a ref would keep
  // the previous provider's data on the screen and let Save PUT it onto the new
  // id. The cleanup aborts the in-flight fetch on param change / StrictMode
  // remount so only the latest request can settle state.
  useEffect(() => {
    if (mode !== "edit") return;
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [mode, load]);

  const dirty = isDraftDirty(draft, baseline);

  // Router-level dirty guard. The Identity tabs / Settings sidebar / SPA back
  // button are all in-app navigations, which `beforeunload` does not catch — so
  // a superadmin could leave the editor with unsaved changes and no prompt.
  // `useBlocker` intercepts those; programmatic exits (Cancel after confirm,
  // Save) set `skipBlockRef` first so they don't re-trigger the prompt, and the
  // blocked-state effect sets it before `proceed()` so the retried navigation
  // isn't re-blocked (which would loop).
  const skipBlockRef = useRef(false);
  const location = useLocation();
  // Re-arm the dirty guard after any completed navigation. skipBlock is a one-shot
  // bypass for programmatic exits (Cancel/Save/proceed); without this reset it
  // would stay `true` and suppress the prompt for the next dirty edit too — most
  // visibly when the editor instance persists across an A→B provider navigation.
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

  // Browser reload/close is not an in-app navigation; the router blocker doesn't
  // cover it, so keep the native beforeunload prompt as well.
  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
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
      const validation = validateProviderDraft(draft, mode);
      setErrors(validation);
      if (Object.keys(validation).length > 0) {
        addToast("Please fix the highlighted fields.", "error");
        return;
      }
      setSaving(true);
      try {
        const body = buildSaveBody(draft, mode, mappings);
        const saved = mode === "create"
          ? await createIdentityProvider(body)
          : await updateIdentityProvider(resolvedProviderId!, body);
        addToast(mode === "create" ? "Provider created." : "Provider updated.", "success");
        skipBlockRef.current = true;
        navigate(IDENTITY_PROVIDERS_ROUTE);
        void saved;
      } catch (err) {
        const message = err instanceof ApiError ? err.message : "Failed to save provider.";
        addToast(message, "error");
      } finally {
        setSaving(false);
      }
    },
    [draft, mode, mappings, resolvedProviderId, addToast, navigate],
  );

  const title = mode === "create" ? "Add identity provider" : "Edit identity provider";

  const loadingContent = (
    <div className="identity-editor__loading" role="status">
      <Spinner label="Loading provider" />
    </div>
  );

  const errorContent = (
    <Card title={title}>
      <div className="identity-editor__error">
        <p>Couldn't load this provider.</p>
        <Button
          variant="secondary"
          onClick={() => {
            const controller = new AbortController();
            void load(controller.signal);
          }}
        >
          Retry
        </Button>
      </div>
    </Card>
  );

  const notFoundContent = (
    <Card title={title}>
      <div className="identity-editor__error">
        <p>This provider no longer exists.</p>
        <Button variant="secondary" onClick={() => navigate(IDENTITY_PROVIDERS_ROUTE)}>
          Back to providers
        </Button>
      </div>
    </Card>
  );

  const formContent = (
    <form className="identity-editor" onSubmit={handleSubmit} noValidate>
      <Card title="Basics">
        <div className="identity-editor__grid">
          <Input
            label="Display name"
            value={draft.display_name}
            invalid={Boolean(errors.display_name)}
            error={errors.display_name}
            onChange={(e) => setDraft((d) => setField(d, "display_name", e.target.value))}
            placeholder="Google"
            required
          />
          <Input
            label="Issuer URL"
            value={draft.issuer}
            invalid={Boolean(errors.issuer)}
            error={errors.issuer}
            onChange={(e) => setDraft((d) => setField(d, "issuer", e.target.value))}
            placeholder="https://accounts.google.com"
            required
          />
          <Input
            label="Client ID"
            value={draft.client_id}
            invalid={Boolean(errors.client_id)}
            error={errors.client_id}
            onChange={(e) => setDraft((d) => setField(d, "client_id", e.target.value))}
            required
          />
          <Input
            label={mode === "edit" ? (hasSecret ? "New client secret" : "Client secret") : "Client secret"}
            type="password"
            value={draft.client_secret}
            invalid={Boolean(errors.client_secret)}
            error={errors.client_secret}
            hint={
              mode === "edit" && hasSecret
                ? "Leave blank to keep the stored secret."
                : undefined
            }
            onChange={(e) => setDraft((d) => setField(d, "client_secret", e.target.value))}
            autoComplete="new-password"
            required={mode === "create"}
          />
          <div className="identity-editor__switch">
            <Switch
              id="idp-enabled"
              label="Enabled"
              checked={draft.enabled}
              onChange={(e) => setDraft((d) => setField(d, "enabled", e.target.checked))}
            />
          </div>
        </div>
      </Card>

      <Card title="Endpoints">
        <div className="identity-editor__grid">
          <Input
            label="Authorization endpoint"
            value={draft.authorization_endpoint}
            invalid={Boolean(errors.authorization_endpoint)}
            error={errors.authorization_endpoint}
            onChange={(e) => setDraft((d) => setField(d, "authorization_endpoint", e.target.value))}
            placeholder="https://accounts.google.com/o/oauth2/v2/auth"
          />
          <Input
            label="Token endpoint"
            value={draft.token_endpoint}
            invalid={Boolean(errors.token_endpoint)}
            error={errors.token_endpoint}
            onChange={(e) => setDraft((d) => setField(d, "token_endpoint", e.target.value))}
            placeholder="https://oauth2.googleapis.com/token"
          />
          <Input
            label="JWKS URI"
            value={draft.jwks_uri}
            invalid={Boolean(errors.jwks_uri)}
            error={errors.jwks_uri}
            onChange={(e) => setDraft((d) => setField(d, "jwks_uri", e.target.value))}
            placeholder="https://www.googleapis.com/oauth2/v3/certs"
          />
          <Input
            label="UserInfo endpoint"
            value={draft.userinfo_endpoint}
            invalid={Boolean(errors.userinfo_endpoint)}
            error={errors.userinfo_endpoint}
            onChange={(e) => setDraft((d) => setField(d, "userinfo_endpoint", e.target.value))}
            placeholder="https://openidconnect.googleapis.com/v1/userinfo"
          />
        </div>
      </Card>

      <Card title="Claims">
        <div className="identity-editor__grid">
          <Input
            label="Email claim"
            value={draft.claim_email}
            invalid={Boolean(errors.claim_email)}
            error={errors.claim_email}
            onChange={(e) => setDraft((d) => setField(d, "claim_email", e.target.value))}
            placeholder="email"
          />
          <Input
            label="Name claim"
            value={draft.claim_name}
            invalid={Boolean(errors.claim_name)}
            error={errors.claim_name}
            onChange={(e) => setDraft((d) => setField(d, "claim_name", e.target.value))}
            placeholder="name"
          />
          <Input
            label="Groups claim"
            value={draft.claim_groups}
            invalid={Boolean(errors.claim_groups)}
            error={errors.claim_groups}
            hint="Groups are matched against the group-to-role mapping (slice 3b)."
            onChange={(e) => setDraft((d) => setField(d, "claim_groups", e.target.value))}
            placeholder="groups"
          />
        </div>
      </Card>

      <Card title="Login button">
        <div className="identity-editor__grid">
          <Input
            label="SSO login button label"
            value={draft.login_button_label}
            invalid={Boolean(errors.login_button_label)}
            error={errors.login_button_label}
            hint="Leave blank to use the product default. A live preview lands in slice 3b."
            onChange={(e) => setDraft((d) => setField(d, "login_button_label", e.target.value))}
            placeholder="Continue with Google"
          />
        </div>
      </Card>

      <div className="identity-editor__actions">
        <Button type="button" variant="ghost" onClick={handleCancel} disabled={saving}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={saving || loadState !== "ready"}>
          {saving ? "Saving…" : mode === "create" ? "Create provider" : "Save changes"}
        </Button>
      </div>
    </form>
  );

  return (
    <div className="identity-editor__page">
      {mode === "edit" && loadState === "loading" && loadingContent}
      {mode === "edit" && loadState === "error" && errorContent}
      {mode === "edit" && loadState === "not_found" && notFoundContent}
      {((mode === "edit" && loadState === "ready") || mode === "create") && (
        <>
          <div className="identity-editor__header">
            <h2 className="identity-editor__title">{title}</h2>
            <p className="identity-editor__subtitle">
              {mode === "create"
                ? "Register an OpenID Connect identity provider for single sign-on."
                : "Update this OpenID Connect identity provider."}
            </p>
          </div>
          {formContent}
        </>
      )}
    </div>
  );
}
