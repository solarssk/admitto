import { useCallback, useEffect, useRef, useState } from "react";
import { useBlocker, useLocation, useNavigate, useParams } from "react-router-dom";
import type { BlockerFunction } from "react-router";
import { Button, Card, Input, Spinner, Switch, useToast } from "@admitto/ui";
import {
  ApiError,
  createIdentityProvider,
  discoverIdentityProvider,
  discoverIdentityProviderPreview,
  fetchIdentityProvider,
  testIdentityProviderDraft,
  updateIdentityProvider,
} from "../api/client.js";
import { operatorApiErrorMessage } from "../api/operator-api-error.js";
import type { ProviderDetailDto, ProviderRequestBody, ProviderTestDraftBody } from "../api/types.js";
import { IdentityMappingRepeater } from "./IdentityMappingRepeater.js";
import {
  emptyProviderDraft,
  isDraftDirty,
  newMappingId,
  validateMappings,
  validateProviderDraft,
  type EditorMode,
  type FieldErrors,
  type MappingRow,
  type MappingRowError,
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

/** Map a loaded provider's mappings into editable repeater rows (with stable ids). */
function mappingsFromDetail(detail: ProviderDetailDto): MappingRow[] {
  return detail.mappings.map((m) => ({
    id: newMappingId(),
    group: m.group,
    role: m.role as MappingRow["role"],
    scope_type: m.scope_type as MappingRow["scope_type"],
    scope_id: m.scope_id ?? "",
  }));
}

/** Map repeater rows into the request body shape (scope_id null for instance scope). */
function mappingsToBody(rows: MappingRow[]): ProviderRequestBody["mappings"] {
  return rows.map((r) => ({
    group: r.group.trim(),
    role: r.role,
    scope_type: r.scope_type,
    scope_id: r.scope_type === "instance" ? null : r.scope_id.trim() || null,
  }));
}

function mappingsEqual(a: MappingRow[], b: MappingRow[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((row, i) =>
    row.group === b[i].group &&
    row.role === b[i].role &&
    row.scope_type === b[i].scope_type &&
    row.scope_id === b[i].scope_id,
  );
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
  mappings: MappingRow[],
): ProviderRequestBody {
  const body: ProviderRequestBody = {
    display_name: draft.display_name.trim(),
    issuer: draft.issuer.trim(),
    client_id: draft.client_id.trim(),
    // Optional endpoint/claim fields: send `undefined` when blank so the JSON
    // body omits them (semantically "not configured"), matching how the server's
    // toProviderInput maps "" → undefined. Sending "" would be accepted but is
    // a different shape than omitting the field.
    authorization_endpoint: draft.authorization_endpoint.trim() || undefined,
    token_endpoint: draft.token_endpoint.trim() || undefined,
    jwks_uri: draft.jwks_uri.trim() || undefined,
    userinfo_endpoint: draft.userinfo_endpoint.trim() || undefined,
    claim_email: draft.claim_email.trim() || undefined,
    claim_name: draft.claim_name.trim() || undefined,
    claim_groups: draft.claim_groups.trim() || undefined,
    enabled: draft.enabled,
    // Empty label clears to the product default; a string sets it.
    login_button_label: draft.login_button_label.trim() || null,
    mappings: mappingsToBody(mappings),
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

/** Session expired mid-fetch: hand off to login with a return path (matches the
 * pattern used across the admin SPA, e.g. IdentityProvidersPanel/ReportsPage). */
function redirectToLogin(): void {
  const next = encodeURIComponent(window.location.pathname);
  window.location.assign(`/login?next=${next}`);
}

function oidcTestBodyFromDraft(draft: ProviderDraft): ProviderTestDraftBody {
  const body: ProviderTestDraftBody = { issuer: draft.issuer.trim() };
  const authorization = draft.authorization_endpoint.trim();
  const token = draft.token_endpoint.trim();
  const jwks = draft.jwks_uri.trim();
  const userinfo = draft.userinfo_endpoint.trim();
  if (authorization) body.authorization_endpoint = authorization;
  if (token) body.token_endpoint = token;
  if (jwks) body.jwks_uri = jwks;
  if (userinfo) body.userinfo_endpoint = userinfo;
  return body;
}

function setField<K extends keyof ProviderDraft>(
  draft: ProviderDraft,
  key: K,
  value: ProviderDraft[K],
): ProviderDraft {
  const next = { ...draft, [key]: value };
  if (key === "client_secret") {
    // touched tracks "operator entered a new secret to save". Clearing the field
    // back to blank means "keep the stored secret" — no effective change — so
    // reset touched so isDraftDirty and the dirty guard don't fire on a no-op,
    // and buildSaveBody doesn't send an empty secret that would overwrite it.
    next.client_secret_touched = next.client_secret.length > 0;
  }
  return next;
}

/** Resolve the effective provider id: explicit prop wins; edit mode falls back
 * to the route param so the routed element can stay prop-less. */
function resolveProviderId(
  explicitId: string | undefined,
  mode: EditorMode,
  routeParamId: string | undefined,
): string | undefined {
  return explicitId ?? (mode === "edit" ? routeParamId : undefined);
}

function initialLoadState(mode: EditorMode): LoadState {
  return mode === "edit" ? "loading" : "ready";
}

function computeDirty(
  draft: ProviderDraft,
  baseline: ProviderDraft,
  mappings: MappingRow[],
  baselineMappings: MappingRow[],
): boolean {
  return isDraftDirty(draft, baseline) || !mappingsEqual(mappings, baselineMappings);
}

function editorTitle(mode: EditorMode): string {
  return mode === "create" ? "Add identity provider" : "Edit identity provider";
}

function editorSubtitle(mode: EditorMode): string {
  return mode === "create"
    ? "Register an OpenID Connect identity provider for single sign-on."
    : "Update this OpenID Connect identity provider.";
}

function clientSecretFieldLabel(mode: EditorMode, hasSecret: boolean): string {
  if (mode !== "edit") return "Client secret";
  return hasSecret ? "New client secret" : "Client secret";
}

function clientSecretFieldHint(mode: EditorMode, hasSecret: boolean): string | undefined {
  return mode === "edit" && hasSecret ? "Leave blank to keep the stored secret." : undefined;
}

function discoverButtonLabel(discovering: boolean): string {
  return discovering ? "Discovering…" : "Discover";
}

function testButtonLabel(testing: boolean): string {
  return testing ? "Testing…" : "Test connection";
}

function submitButtonLabel(saving: boolean, mode: EditorMode): string {
  if (saving) return "Saving…";
  return mode === "create" ? "Create provider" : "Save changes";
}

function loginButtonPreviewLabel(label: string): string {
  return label.trim() || "Continue with SSO";
}

/** True while any async editor action (discover/test/save) is in flight. */
function isActionBusy(saving: boolean, testing: boolean, discovering: boolean): boolean {
  return saving || testing || discovering;
}

/** True once the form is usable: create mode is always ready; edit mode needs
 * the provider to have finished loading. */
function isFormLocked(mode: EditorMode, loadState: LoadState): boolean {
  return mode === "edit" && loadState !== "ready";
}

/** Shared disabled-state for the Test/Save actions (busy, or edit mode still loading). */
function actionsDisabled(
  saving: boolean,
  testing: boolean,
  discovering: boolean,
  mode: EditorMode,
  loadState: LoadState,
): boolean {
  return isActionBusy(saving, testing, discovering) || isFormLocked(mode, loadState);
}

type EditorView = "loading" | "error" | "not_found" | "form";

/** Which top-level content the page shows for the current mode/load state. */
function resolveEditorView(mode: EditorMode, loadState: LoadState): EditorView {
  if (mode === "create" || loadState === "ready") return "form";
  return loadState;
}

/**
 * OIDC identity provider editor (#266). Basics, Endpoints, Claims, and the SSO
 * login button label shipped in slice 3a; slice 3b adds the group→role mapping
 * repeater, Discover/Test actions, and a live SSO button preview. Create mode
 * POSTs a new provider; edit mode loads by id and PUTs the full form (mappings
 * use replace-all semantics — the slice-1 PUT contract requires `mappings`).
 */
export function IdentityProviderEditor({
  mode,
  providerId,
}: Readonly<IdentityProviderEditorProps>) {
  const navigate = useNavigate();
  const { addToast } = useToast();
  const routeParams = useParams();
  const resolvedProviderId = resolveProviderId(providerId, mode, routeParams.providerId);
  const [draft, setDraft] = useState<ProviderDraft>(() => emptyProviderDraft());
  const [baseline, setBaseline] = useState<ProviderDraft>(() => emptyProviderDraft());
  const [mappings, setMappings] = useState<MappingRow[]>([]);
  const [baselineMappings, setBaselineMappings] = useState<MappingRow[]>([]);
  const [mappingErrors, setMappingErrors] = useState<MappingRowError[]>([]);
  const [loadState, setLoadState] = useState<LoadState>(initialLoadState(mode));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saving, setSaving] = useState(false);
  const [hasSecret, setHasSecret] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [testing, setTesting] = useState(false);
  // Retry tick drives the load effect (mount + Retry button), mirroring the
  // providersRetry/cfRetry pattern in IdentityProvidersPanel (#296). Each effect
  // run owns its AbortController and aborts on cleanup, so a StrictMode remount
  // and a Retry both re-fetch cleanly — no one-shot ref (which stranded #296 in
  // dev) and no ad-hoc AbortController on the Retry button (which leaked).
  const [loadTick, setLoadTick] = useState(0);

  // Latest resolvedProviderId for stale-response guards on button-triggered
  // async actions (Discover/Test). `load` is effect-driven and aborts on
  // provider change via its AbortController cleanup, but Discover/Test are
  // click-triggered with no abort signal — if the operator navigates A→B while
  // a discover is in flight, the late setDraft/setBaseline would merge A's
  // discovered endpoints onto B's editor (and a Save could PUT them onto the
  // wrong provider). Capturing the id at call time and comparing against this
  // ref after `await` lets the handler bail on a stale resolution.
  const providerIdRef = useRef(resolvedProviderId);
  providerIdRef.current = resolvedProviderId;

  // Mirrors `providerIdRef` for create mode: capture the issuer at click time and
  // compare it after `await` so a stale response (user edited the issuer while the
  // request was in flight) does not overwrite the current draft or show a toast.
  const draftRef = useRef(draft);
  draftRef.current = draft;

  // Nonce counters guard against parallel discover / test requests (e.g. double-
  // click). The issuer-change guard uses draftRef instead.
  const createDiscoverNonceRef = useRef(0);
  const createTestNonceRef = useRef(0);

  // Reset the Discover/Test busy flags whenever the resolved provider changes.
  // The stale-response guard in handleDiscover/handleTest intentionally does
  // NOT clear the flag when a stale request completes on a different provider
  // (`targetId !== providerIdRef.current`), so without this reset an A→B
  // navigation mid-discover would leave `discovering` stuck `true` on B and
  // permanently disable Discover/Test/Save. `load` re-fetches on the same
  // change, so the flags are re-armed only by a fresh click on B.
  useEffect(() => {
    setDiscovering(false);
    setTesting(false);
  }, [resolvedProviderId]);

  const load = useCallback(
    async (signal: AbortSignal) => {
      if (mode !== "edit" || !resolvedProviderId) return;
      setLoadState("loading");
      // Clear any stale field errors from a previous provider / failed submit so
      // they don't attach to identically-named fields on the newly loaded one.
      setErrors({});
      try {
        const detail = await fetchIdentityProvider(resolvedProviderId, signal);
        const nextDraft = draftFromDetail(detail);
        setDraft(nextDraft);
        setBaseline(nextDraft);
        const nextMappings = mappingsFromDetail(detail);
        setMappings(nextMappings);
        setBaselineMappings(nextMappings);
        setMappingErrors([]);
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
  // from one provider's edit URL to another) or when loadTick advances (Retry).
  // No one-shot ref: a ref would keep the previous provider's data on the screen
  // and let Save PUT it onto the new id, and would strand the editor on a loading
  // skeleton under React StrictMode (the #296 regression). The cleanup aborts the
  // in-flight fetch on param change / Retry / remount so only the latest request
  // can settle state.
  useEffect(() => {
    if (mode !== "edit") return;
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [mode, load, loadTick]);

  const retryLoad = useCallback(() => setLoadTick((n) => n + 1), []);

  const dirty = computeDirty(draft, baseline, mappings, baselineMappings);

  const handleMappingsChange = useCallback((rows: MappingRow[]) => {
    setMappings(rows);
    // Clear row errors as the operator edits; full re-validation runs on submit.
    setMappingErrors((prev) => (prev.length === 0 ? prev : rows.map(() => ({}))));
  }, []);

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
      const mappingValidation = validateMappings(mappings);
      const mappingsOk = mappingValidation.every((e) => Object.keys(e).length === 0);
      setErrors(validation);
      setMappingErrors(mappingValidation);
      if (Object.keys(validation).length > 0 || !mappingsOk) {
        addToast("Please fix the highlighted fields.", "error");
        return;
      }
      setSaving(true);
      try {
        const body = buildSaveBody(draft, mode, mappings);
        if (mode === "create") {
          await createIdentityProvider(body);
        } else if (resolvedProviderId) {
          // Runtime guard: edit mode with no resolvable id (mis-configured route)
          // never reaches updateIdentityProvider with an undefined id.
          await updateIdentityProvider(resolvedProviderId, body);
        } else {
          return;
        }
        addToast(mode === "create" ? "Provider created." : "Provider updated.", "success");
        skipBlockRef.current = true;
        navigate(IDENTITY_PROVIDERS_ROUTE);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          redirectToLogin();
          return;
        }
        const message = operatorApiErrorMessage(err, "Failed to save provider.");
        addToast(message, "error");
      } finally {
        setSaving(false);
      }
    },
    [draft, mode, mappings, resolvedProviderId, addToast, navigate],
  );

  // Discover autofills endpoints from the issuer's .well-known config. Split
  // into create/edit variants (each independently below the complexity limit)
  // since the two modes hit different endpoints and guard against staleness
  // differently; `handleDiscover` just validates the issuer and dispatches.
  const handleDiscoverCreate = useCallback(
    async (issuer: string) => {
      const nonce = ++createDiscoverNonceRef.current;
      const issuerAtRequest = issuer;
      setDiscovering(true);
      try {
        const result = await discoverIdentityProviderPreview(issuer);
        if (createDiscoverNonceRef.current !== nonce) return;
        if (draftRef.current.issuer.trim() !== issuerAtRequest) return;
        const discovered = {
          authorization_endpoint: result.endpoints.authorization_endpoint,
          token_endpoint: result.endpoints.token_endpoint,
          jwks_uri: result.endpoints.jwks_uri,
          userinfo_endpoint: result.endpoints.userinfo_endpoint ?? "",
        };
        setDraft((d) => ({
          ...d,
          ...discovered,
          issuer: result.endpoints.issuer || d.issuer,
        }));
        addToast("Endpoints discovered from the issuer.", "success");
      } catch (err) {
        if (createDiscoverNonceRef.current !== nonce) return;
        if (draftRef.current.issuer.trim() !== issuerAtRequest) return;
        if (err instanceof ApiError && err.status === 401) {
          redirectToLogin();
          return;
        }
        const message = operatorApiErrorMessage(err, "Discovery failed.");
        addToast(message, "error");
      } finally {
        setDiscovering(false);
      }
    },
    [addToast],
  );

  const handleDiscoverEdit = useCallback(async () => {
    if (!resolvedProviderId) return;
    const targetId = resolvedProviderId;
    setDiscovering(true);
    try {
      const result = await discoverIdentityProvider(targetId);
      // Bail if the operator navigated to a different provider while discovery
      // was in flight — otherwise the late setDraft/setBaseline would merge A's
      // discovered endpoints onto B's editor and a Save could PUT them onto the
      // wrong provider (Bugbot high).
      if (targetId !== providerIdRef.current) return;
      // Patch only the discovered endpoint fields on the draft so the operator's
      // other unsaved edits (display_name, claims, label, secret, enabled,
      // mappings) are preserved.
      const discovered = {
        authorization_endpoint: result.endpoints.authorization_endpoint,
        token_endpoint: result.endpoints.token_endpoint,
        jwks_uri: result.endpoints.jwks_uri,
        userinfo_endpoint: result.endpoints.userinfo_endpoint ?? "",
      };
      setDraft((d) => ({
        ...d,
        ...discovered,
        issuer: result.endpoints.issuer || d.issuer,
      }));
      // Discover persists issuer + endpoints server-side, so fold the saved
      // state into the dirty baseline too — otherwise the dirty guard would
      // warn on Cancel / browser-close even though those fields are already
      // saved, and "Discard unsaved changes?" would misleadingly imply the
      // discovered endpoints get undone (Codex P2). Use the refreshed
      // `result.provider` the API returns as the authoritative baseline
      // (also syncs hasSecret + baselineMappings); fall back to a targeted
      // baseline patch if the server didn't echo the provider.
      if (result.provider) {
        const refreshedDraft = draftFromDetail(result.provider);
        setBaseline(refreshedDraft);
        setBaselineMappings(mappingsFromDetail(result.provider));
        setHasSecret(result.provider.has_client_secret);
      } else {
        setBaseline((b) => ({
          ...b,
          ...discovered,
          issuer: result.endpoints.issuer || b.issuer,
        }));
      }
      addToast("Endpoints discovered from the issuer.", "success");
    } catch (err) {
      if (targetId !== providerIdRef.current) return;
      if (err instanceof ApiError && err.status === 401) {
        redirectToLogin();
        return;
      }
      const message = operatorApiErrorMessage(err, "Discovery failed.");
      addToast(message, "error");
    } finally {
      if (targetId === providerIdRef.current) setDiscovering(false);
    }
  }, [resolvedProviderId, addToast]);

  const handleDiscover = useCallback(async () => {
    const issuer = draft.issuer.trim();
    if (!issuer) {
      addToast("Issuer URL is required for discovery.", "error");
      return;
    }
    if (mode === "create") {
      await handleDiscoverCreate(issuer);
      return;
    }
    await handleDiscoverEdit();
  }, [draft.issuer, mode, handleDiscoverCreate, handleDiscoverEdit, addToast]);

  // Test probes the draft endpoints (create + edit) without requiring a prior save.
  const handleTest = useCallback(async () => {
    if (!draft.issuer.trim()) {
      addToast("Issuer URL is required to test the connection.", "error");
      return;
    }
    const targetId = mode === "edit" ? resolvedProviderId : "create";
    const createNonce = mode === "create" ? ++createTestNonceRef.current : 0;
    const testedBody = oidcTestBodyFromDraft(draft);
    const testedBodyJson = JSON.stringify(testedBody);
    const isStale = () =>
      mode === "edit"
        ? targetId !== providerIdRef.current ||
          JSON.stringify(oidcTestBodyFromDraft(draftRef.current)) !== testedBodyJson
        : createTestNonceRef.current !== createNonce ||
          JSON.stringify(oidcTestBodyFromDraft(draftRef.current)) !== testedBodyJson;
    setTesting(true);
    try {
      const result = await testIdentityProviderDraft(testedBody);
      if (isStale()) return;
      addToast(
        result.ok ? "Connection test passed." : result.error ?? "Connection test failed.",
        result.ok ? "success" : "error",
      );
    } catch (err) {
      if (isStale()) return;
      if (err instanceof ApiError && err.status === 401) {
        redirectToLogin();
        return;
      }
      const message = operatorApiErrorMessage(err, "Connection test failed.");
      addToast(message, "error");
    } finally {
      if (mode === "create" || targetId === providerIdRef.current) setTesting(false);
    }
  }, [draft, mode, resolvedProviderId, addToast]);

  const title = editorTitle(mode);

  const loadingContent = (
    <output className="identity-editor__loading">
      <Spinner label="Loading provider" />
    </output>
  );

  const errorContent = (
    <Card title={title}>
      <div className="identity-editor__error">
        <p>Couldn't load this provider.</p>
        <Button
          variant="secondary"
          onClick={retryLoad}
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
            label={clientSecretFieldLabel(mode, hasSecret)}
            type="password"
            value={draft.client_secret}
            invalid={Boolean(errors.client_secret)}
            error={errors.client_secret}
            hint={clientSecretFieldHint(mode, hasSecret)}
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

      <Card
        title="Endpoints"
        actions={
          <div className="identity-editor__card-actions">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={handleDiscover}
              disabled={isActionBusy(saving, testing, discovering)}
            >
              {discoverButtonLabel(discovering)}
            </Button>
          </div>
        }
      >
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
            hint="Groups from this claim are matched against the mapping below."
            onChange={(e) => setDraft((d) => setField(d, "claim_groups", e.target.value))}
            placeholder="groups"
          />
        </div>
      </Card>

      <Card title="Group → role mapping">
        <p className="identity-mappings__intro">
          Map OIDC groups (from the groups claim) to Admitto roles. The full list replaces the
          stored mappings on every save.
        </p>
        <IdentityMappingRepeater
          rows={mappings}
          errors={mappingErrors}
          onChange={handleMappingsChange}
        />
      </Card>

      <Card title="Login button">
        <div className="identity-editor__grid">
          <Input
            label="SSO login button label"
            value={draft.login_button_label}
            invalid={Boolean(errors.login_button_label)}
            error={errors.login_button_label}
            hint="Leave blank to use the product default ('Continue with SSO')."
            onChange={(e) => setDraft((d) => setField(d, "login_button_label", e.target.value))}
            placeholder="Continue with Google"
          />
        </div>
        <div className="identity-sso-preview" aria-label="SSO login button preview">
          <span className="identity-sso-preview__label">Preview</span>
          <span className="identity-sso-preview__button">
            {loginButtonPreviewLabel(draft.login_button_label)}
          </span>
        </div>
      </Card>

      <div className="identity-editor__actions">
        <Button type="button" variant="ghost" onClick={handleCancel} disabled={isActionBusy(saving, testing, discovering)}>
          Cancel
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={handleTest}
          disabled={actionsDisabled(saving, testing, discovering, mode, loadState)}
        >
          {testButtonLabel(testing)}
        </Button>
        <Button
          type="submit"
          variant="primary"
          disabled={actionsDisabled(saving, testing, discovering, mode, loadState)}
        >
          {submitButtonLabel(saving, mode)}
        </Button>
      </div>
    </form>
  );

  const view = resolveEditorView(mode, loadState);
  return (
    <div className="identity-editor__page">
      {view === "loading" && loadingContent}
      {view === "error" && errorContent}
      {view === "not_found" && notFoundContent}
      {view === "form" && (
        <>
          <div className="identity-editor__header">
            <h2 className="identity-editor__title">{title}</h2>
            <p className="identity-editor__subtitle">{editorSubtitle(mode)}</p>
          </div>
          {formContent}
        </>
      )}
    </div>
  );
}
