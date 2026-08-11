import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Badge, Button, Card, Checkbox, EmptyState, HintLabel, Input, Notice, PasswordStrengthMeter, Spinner, useToast } from "@admitto/ui";
import {
  ApiError,
  cancelMfaEnroll,
  confirmMfaTotp,
  deleteAccountSession,
  enrollMfaTotp,
  fetchAccount,
  fetchAccountSessions,
  patchAccountPassword,
  patchAccountProfile,
  resetMfa,
  unlinkAccountExternalIdentity,
} from "../api/client.js";
import { hasApiErrorCode, operatorApiErrorMessage } from "../api/operator-api-error.js";
import { PASSWORD_MIN_LENGTH } from "@admitto/auth/constants";
import type { AccountDto, AccountRoleDto, MfaEnrollResponse, SessionListDto } from "../api/types.js";
import { roleLabel } from "../auth/role-labels.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { GeoCell } from "../components/GeoCell.js";
import { MoreActionsMenuItem } from "../components/MoreActionsMenuItem.js";
import { PhoneCountrySelect } from "../components/PhoneCountrySelect.js";
import { SearchableSelect } from "../components/SearchableSelect.js";
import { useDropdownMenu } from "../components/useDropdownMenu.js";
import { NO_AUTOFILL_PROPS } from "../settings/mailTransportFormParts.js";
import { SessionRevokeAction, SessionSignIn } from "../pages/users/SessionListItem.js";
import { useDelayedLoading } from "../hooks/useDelayedLoading.js";
import { ActorOrViewerLocalTimeLine } from "../components/ActorOrViewerLocalTimeLine.js";
import { formatRelativeTime } from "../utils/event-dates.js";
import { LOCALE_OPTIONS, setPreferredLocale as setPreferredLocaleStore } from "../utils/locale-store.js";
import { parseUserAgent } from "../utils/parseUserAgent.js";
import { TotpDigitInput } from "./TotpDigitInput.js";
import { TotpQrCode } from "./TotpQrCode.js";

const PASSWORD_HINT = "Changing your password ends your other active sessions. Your current session stays signed in.";

/** Whether an assignment grants a real admin/operator surface - mirrors resolvePostAuthPath's
 * own notion of "usable" (packages/auth/src/post-auth.ts), duplicated locally rather than
 * imported: @admitto/auth's package entrypoint pulls in @admitto/db and its Prisma engine,
 * which has no business in this frontend bundle. An admin assignment with a missing scope_id
 * (a corrupt/legacy row) still shows up in `roles`, but grants nothing - so a roles.length check
 * alone would skip this notice for exactly the account that needs it. */
function isUsableRoleAssignment(role: AccountRoleDto): boolean {
  if (role.role === "superadmin") return role.scope_type === "instance";
  if (role.role === "admin") return role.scope_type === "organization" && role.scope_id != null;
  return role.role === "operator";
}

/** Discourage password managers from offering to save a "login" for a TOTP/backup-code field. */
const stepUpCodeFieldAttrs = {
  "data-bwignore": "",
  "data-lpignore": "true",
  "data-1p-ignore": "",
  "data-form-type": "other",
} as const;

/** "2026-01-01 12:00:00" - same UTC-primary convention as Users → Active sessions. */
function formatSessionPrimaryTime(iso: string): string {
  return `${iso.slice(0, 19).replace("T", " ")} UTC`;
}

/** Same .txt format and filename as the server-rendered MFA enrollment download. */
function downloadBackupCodes(codes: string[]): void {
  const blob = new Blob([codes.join("\n") + "\n"], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "admitto-backup-codes.txt";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function isTotpEnrolled(account: AccountDto): boolean {
  return account.mfa_methods.some((m) => m.type === "totp" && m.confirmed);
}

function accountTypeHint(account: AccountDto, isManaged: boolean): string {
  if (!isManaged) return "Signed in with a password you set. Manage it in the Password section below.";
  if (account.has_local_password) {
    return "Signed in through your organization's identity provider, with a local password available as a fallback. Manage it in the Password section below.";
  }
  return "Signed in through your organization's identity provider — password and two-factor authentication are managed there.";
}

/** How this account exists, not how the current browser session happens to be signed in - "Local
 * account" when it only has a password, or "Managed by <provider>" naming the actual linked
 * identity provider(s) (not a generic "SSO") whenever any are linked, since the IdP is the
 * source of truth for sign-in once linked even if a local fallback password also exists. Reuses
 * the same disabled SearchableSelect shape as the Role field below for one consistent look.
 * Actions (Unlink / Connect) live in the Profile card's header menu, not here - with an unknown
 * number of identity providers a growing row of buttons under this field doesn't scale. */
function AccountTypeField({ account }: Readonly<{ account: AccountDto }>) {
  const providers = account.external_identities;
  const isManaged = providers.length > 0;
  const label = isManaged ? `Managed by ${providers.map((p) => p.provider_display_name).join(" + ")}` : "Local account";
  const hint = accountTypeHint(account, isManaged);

  return (
    <div className="account-role-display">
      <label className="at-label" htmlFor="account-type">Account type</label>
      <SearchableSelect
        id="account-type"
        label="Account type"
        showLabel={false}
        placeholder="Account type"
        searchPlaceholder=""
        emptyLabel=""
        value="current"
        options={[{ id: "current", label, icon: isManaged ? "shield-lock" : "key" }]}
        disabled
        title="Account type is determined automatically and can't be changed here."
        onChange={() => {}}
      />
      <p className="at-hint">{hint}</p>
    </div>
  );
}

/** Profile card header's "..." menu - Unlink SSO (when linked) and one "Connect <provider>" item
 * per enabled, not-yet-linked provider. A menu instead of a row of buttons because the button
 * row grows one item per identity provider and gets unwieldy fast with more than one configured;
 * the same collapse-into-a-menu treatment as the admin Edit user modal's own kebab menu
 * (UserMoreActionsMenu). Not rendered at all when there's nothing to show. */
function AccountIdentityActionsMenu({
  account,
  moreActions,
  onUnlinkClick,
}: Readonly<{
  account: AccountDto;
  moreActions: ReturnType<typeof useDropdownMenu<HTMLButtonElement>>;
  onUnlinkClick: () => void;
}>) {
  const isManaged = account.external_identities.length > 0;
  // Connect re-authenticates through /account/oidc/:id/link, which hard-requires a real local
  // password to prove who's asking - an account with none (a JIT-provisioned SSO user who never
  // set one) can never finish that flow, so don't offer an action guaranteed to dead-end.
  const canConnect = account.has_local_password && account.available_identity_providers.length > 0;
  if (!isManaged && !canConnect) return null;

  const pick = (action: () => void) => () => {
    moreActions.setOpen(false);
    action();
  };

  return (
    <div className="more-actions-menu" ref={moreActions.rootRef}>
      <Button
        ref={moreActions.triggerRef}
        type="button"
        variant="secondary"
        size="sm"
        hasMenu
        aria-haspopup="menu"
        aria-expanded={moreActions.open}
        onClick={() => moreActions.setOpen((o) => !o)}
        icon={<i className="ti ti-shield-lock" aria-hidden="true" />}
      >
        SSO
      </Button>
      {moreActions.open && (
        <div
          className="more-actions-menu__panel"
          role="menu"
          ref={moreActions.panelRef}
          style={moreActions.panelStyle}
        >
          {isManaged && (
            <MoreActionsMenuItem
              icon="unlink"
              label="Unlink SSO"
              hint="Sign in with a password instead"
              onClick={pick(onUnlinkClick)}
            />
          )}
          {canConnect &&
            account.available_identity_providers.map((p) => (
              <MoreActionsMenuItem
                key={p.id}
                icon="plus"
                label={`Connect ${p.display_name}`}
                hint="Add as another sign-in method"
                onClick={pick(() => {
                  window.location.assign(`/account/oidc/${encodeURIComponent(p.id)}/link?next=/account`);
                })}
              />
            ))}
        </div>
      )}
    </div>
  );
}

const ROLE_TYPE_OPTIONS = [
  { id: "superadmin", label: roleLabel("superadmin"), icon: "crown" },
  { id: "admin", label: roleLabel("admin"), icon: "building" },
  { id: "operator", label: roleLabel("operator"), icon: "calendar-event" },
];

const ROLE_ACCESS_DESCRIPTION: Record<string, string> = {
  superadmin: "Superadmin has access to every event and organization in this instance.",
  admin: "Admin has management access within the organizations listed below.",
  operator: "Operator has check-in and event-day access for the events listed below.",
};

/** Read-only role display, borrowed from the admin Edit user modal's own "Role & access" section
 * (SearchableSelect, disabled - the same control that section already shows when an admin views
 * their own account) instead of a plain badge list, plus the actual scope names (event titles /
 * organization names) as chips, resolved server-side from the account's own assignments. */
function AccountRoleDisplay({ account }: Readonly<{ account: AccountDto }>) {
  const primary = account.roles[0];
  if (!primary) return <p className="at-hint">No role assigned.</p>;

  return (
    <div className="account-role-display">
      <label className="at-label" htmlFor="account-role">Role</label>
      <SearchableSelect
        id="account-role"
        label="Role"
        showLabel={false}
        placeholder="No role assigned"
        searchPlaceholder="Search roles…"
        emptyLabel="No roles found"
        value={primary.role}
        options={ROLE_TYPE_OPTIONS}
        disabled
        title="Roles are read-only. Contact an administrator to change access."
        onChange={() => {}}
      />
      <p className="at-hint">Only an administrator can change this. {ROLE_ACCESS_DESCRIPTION[primary.role]}</p>
      {primary.role !== "superadmin" && account.roles.length > 0 && (
        <div className="account-scope-chips">
          {account.roles.map((r) => (
            <span key={r.id} className="account-scope-chip">
              <i className={`ti ti-${r.scope_type === "event" ? "calendar-event" : "building"}`} aria-hidden="true" />
              {r.is_oidc && (
                <>
                  <i className="ti ti-cloud-lock" aria-hidden="true" title="Managed by identity provider" />
                  <span className="sr-only">Managed by identity provider</span>
                </>
              )}
              {r.scope_label ?? r.scope_id ?? "Unknown"}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function redirectToLoginIfUnauthorized(err: unknown): boolean {
  if (err instanceof ApiError && err.status === 401) {
    const next = encodeURIComponent(window.location.pathname);
    window.location.assign(`/login?next=${next}`);
    return true;
  }
  return false;
}

async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand("copy");
    textarea.remove();
    return ok;
  } catch {
    return false;
  }
}

export function AccountPage() {
  const { addToast } = useToast();
  const [account, setAccount] = useState<AccountDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [preferredLocale, setPreferredLocale] = useState<string | null>(null);
  const [phoneCountryCode, setPhoneCountryCode] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [profileSaving, setProfileSaving] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordCode, setPasswordCode] = useState("");
  const [passwordStepUpOpen, setPasswordStepUpOpen] = useState(false);
  const [passwordCodeError, setPasswordCodeError] = useState<string | null>(null);
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [enrollData, setEnrollData] = useState<MfaEnrollResponse | null>(null);
  const [totpCode, setTotpCode] = useState("");
  const totpInputKey = useRef(0);
  const [mfaEnrolling, setMfaEnrolling] = useState(false);
  const [mfaConfirming, setMfaConfirming] = useState(false);
  const [resetFormOpen, setResetFormOpen] = useState(false);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [resetPassword, setResetPassword] = useState("");
  const [resetCode, setResetCode] = useState("");
  const [resetCodeRequired, setResetCodeRequired] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionListDto[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<SessionListDto | null>(null);
  const [revoking, setRevoking] = useState(false);
  const [revokeError, setRevokeError] = useState<string | null>(null);
  const [revokeAllOpen, setRevokeAllOpen] = useState(false);
  const [revokeAllBusy, setRevokeAllBusy] = useState(false);
  const [uriCopied, setUriCopied] = useState(false);
  const [showUriManual, setShowUriManual] = useState(false);
  const [qrRenderFailed, setQrRenderFailed] = useState(false);
  const [backupCodesSaved, setBackupCodesSaved] = useState(false);
  const [unlinkSsoOpen, setUnlinkSsoOpen] = useState(false);
  const [unlinkSsoBusy, setUnlinkSsoBusy] = useState(false);
  const [unlinkSsoPassword, setUnlinkSsoPassword] = useState("");
  const [unlinkSsoCurrentPassword, setUnlinkSsoCurrentPassword] = useState("");
  const [unlinkSsoError, setUnlinkSsoError] = useState<string | null>(null);
  const [unlinkStepUpOpen, setUnlinkStepUpOpen] = useState(false);
  const [unlinkCode, setUnlinkCode] = useState("");
  const [unlinkCodeError, setUnlinkCodeError] = useState<string | null>(null);
  const identityActions = useDropdownMenu<HTMLButtonElement>({ align: "end" });

  const loadAccount = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchAccount(signal);
      setAccount(data);
      setDisplayName(data.display_name ?? "");
      setPreferredLocale(data.preferred_locale);
      setPhoneCountryCode(data.phone_country_code ?? "");
      setPhoneNumber(data.phone_number ?? "");
      setPreferredLocaleStore(data.preferred_locale ?? undefined);
    } catch (err) {
      if (signal?.aborted) return;
      if (redirectToLoginIfUnauthorized(err)) return;
      setError(operatorApiErrorMessage(err, "Failed to load account."));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  const loadSessions = useCallback(async (signal?: AbortSignal) => {
    setSessionsLoading(true);
    setSessionsError(null);
    try {
      const data = await fetchAccountSessions(signal);
      setSessions(data.sessions);
    } catch (err) {
      if (signal?.aborted) return;
      if (redirectToLoginIfUnauthorized(err)) return;
      setSessionsError(operatorApiErrorMessage(err, "Failed to load sessions."));
    } finally {
      if (!signal?.aborted) setSessionsLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadAccount(controller.signal);
    void loadSessions(controller.signal);
    return () => controller.abort();
  }, [loadAccount, loadSessions]);

  // A fetch that resolves near-instantly (localhost, a warm cache) would
  // otherwise flash the spinner on and off faster than it can register as
  // "loading" — show it only once the fetch has genuinely taken a moment.
  const showAccountSpinner = useDelayedLoading(loading);
  // Gated on `!loading` too, not just `sessionsLoading` on its own - the sessions card
  // only becomes visible once the account section's own loading gate above clears, so its
  // no-flash window must start counting from there, not from mount (when the account fetch
  // may still have most of its own 200ms left to run, silently eating into the sessions
  // card's window before it's ever shown).
  const showSessionsSpinner = useDelayedLoading(sessionsLoading && !loading);

  if (loading) {
    if (!showAccountSpinner) return null;
    return (
      <Card title="Profile">
        <div className="sessions-status">
          <Spinner label="Loading account" />
        </div>
      </Card>
    );
  }
  if (error) {
    return (
      <Card title="Profile">
        <EmptyState
          title="Could not load account"
          description={error}
          action={
            <Button type="button" variant="secondary" onClick={() => void loadAccount()}>
              Retry
            </Button>
          }
        />
      </Card>
    );
  }

  // account is set after a successful load; failures always set error above.
  /* v8 ignore if */
  if (!account) return null;

  const totpEnrolled = isTotpEnrolled(account);
  const otherSessions = sessions.filter((s) => !s.isCurrent);
  const profileDirty =
    displayName !== (account.display_name ?? "") ||
    preferredLocale !== account.preferred_locale ||
    phoneCountryCode !== (account.phone_country_code ?? "") ||
    phoneNumber !== (account.phone_number ?? "");
  const passwordMismatch =
    confirmPassword.length > 0 && newPassword.length > 0 && confirmPassword !== newPassword;
  const passwordFormValid =
    currentPassword.length > 0 &&
    newPassword.length >= 12 &&
    confirmPassword.length > 0 &&
    !passwordMismatch;

  function handleCopyEnrollmentUri(): void {
    if (!enrollData) return;

    copyTextToClipboard(enrollData.otpauthUri).then((copied) => {
      if (!copied) {
        setShowUriManual(true);
        return;
      }

      if (!qrRenderFailed) setShowUriManual(false);
      setUriCopied(true);
      setTimeout(() => setUriCopied(false), 2000);
    });
  }

  /** Shared by the form's own submit and the step-up dialog's confirm — `code` is only passed once the server has asked for one. */
  async function submitPasswordChange(code?: string): Promise<void> {
    const { sessions_revoked } = await patchAccountPassword({
      current_password: currentPassword,
      new_password: newPassword,
      new_password_confirm: confirmPassword,
      code,
    });
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setPasswordCode("");
    setPasswordStepUpOpen(false);
    const sessionsRevokedPlural = sessions_revoked === 1 ? "" : "s";
    const sessionsRevokedSuffix =
      sessions_revoked > 0 ? ` ${sessions_revoked} other session${sessionsRevokedPlural} revoked.` : "";
    addToast(`Password changed.${sessionsRevokedSuffix}`, "success");
    await loadAccount();
    await loadSessions();
  }

  /** Shared by the confirm dialog's own submit and the step-up dialog's confirm — `code` is only
   * passed once the server has asked for one, same two-step shape as submitPasswordChange. */
  async function submitUnlinkSso(code?: string): Promise<void> {
    await unlinkAccountExternalIdentity({
      new_password: unlinkSsoPassword,
      current_password: account?.has_local_password ? unlinkSsoCurrentPassword : undefined,
      code,
    });
    setUnlinkSsoPassword("");
    setUnlinkSsoCurrentPassword("");
    setUnlinkCode("");
    setUnlinkSsoOpen(false);
    setUnlinkStepUpOpen(false);
    addToast("SSO unlinked. Sign in with your new password next time.", "success");
    await loadAccount();
    await loadSessions();
  }

  function renderBackupCodesSection(enrollment: MfaEnrollResponse): ReactNode {
    if (enrollment.backupCodes.length > 0) {
      return (
        <div className="account-auth-backup">
          <div className="account-auth-backup__head">
            <strong>Backup codes: save all 10, shown once</strong>
            <button
              type="button"
              className="account-uri-copy-btn"
              onClick={() => downloadBackupCodes(enrollment.backupCodes)}
            >
              <i className="ti ti-download" aria-hidden="true" />{" "}
              Download
            </button>
          </div>
          <ul>{enrollment.backupCodes.map((code) => <li key={code}><code>{code}</code></li>)}</ul>
          <div className="account-checkbox-row">
            <Checkbox
              id="account-backup-codes-saved"
              label="I've saved my backup codes"
              checked={backupCodesSaved}
              onChange={(e) => setBackupCodesSaved(e.target.checked)}
            />
          </div>
        </div>
      );
    }
    if (enrollment.backupCodesAlreadyShown) {
      return (
        <p className="mail-field-hint">Backup codes were shown at first setup. Use your saved codes if you need to recover access.</p>
      );
    }
    return null;
  }

  function renderPasswordCard() {
    if (!account) return null;
    return (
      <Card title={<HintLabel hint={PASSWORD_HINT}>Password</HintLabel>}>
      {account.has_local_password && (
        <p className="account-info-block">
          Use at least 12 characters, mixing upper and lowercase letters, numbers, and symbols for a stronger password.
        </p>
      )}
      {!account.has_local_password ? (
        <p className="account-info-block">Password is managed by your identity provider.</p>
      ) : (
        <>
          {account.must_change_password && (
            <Notice variant="warning" role="alert" className="account-warn-block">
              You are required to change your password.
            </Notice>
          )}
          <form
            className="account-password-form"
            aria-label="Change password"
            autoComplete="on"
            onSubmit={async (e) => {
              e.preventDefault();
              if (passwordSaving || !passwordFormValid) return;
              setPasswordSaving(true);
              try {
                await submitPasswordChange();
              } catch (err) {
                if (hasApiErrorCode(err, "totp_required")) {
                  // This account's role requires MFA — collect the step-up code in a
                  // dialog instead of growing this form, so the Password/2FA cards (which
                  // stretch to match each other's height) don't jump when it appears.
                  setPasswordCodeError(null);
                  setPasswordStepUpOpen(true);
                } else {
                  addToast(operatorApiErrorMessage(err, "Failed to change password."), "error");
                }
              } finally {
                setPasswordSaving(false);
              }
            }}
          >
            <input
              type="text"
              name="username"
              autoComplete="username"
              value={account.email}
              readOnly
              tabIndex={-1}
              aria-hidden="true"
              className="sr-only"
            />
            <div className="mail-field-row">
              <label className="mail-field-label" htmlFor="account-current-password">Current password</label>
              <Input
                id="account-current-password"
                name="current-password"
                type="password"
                autoComplete="current-password"
                autoCapitalize="off"
                spellCheck={false}
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
              />
            </div>
            <div className="mail-field-row mail-field-row--password">
              <label className="mail-field-label" htmlFor="account-new-password">
                New password <span className="mail-field-label-optional">(at least 12 characters)</span>
              </label>
              <div className="at-password-slot">
                <Input
                  id="account-new-password"
                  name="new-password"
                  type="password"
                  autoComplete="new-password"
                  autoCapitalize="off"
                  spellCheck={false}
                  passwordRules="minlength: 12;"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  minLength={12}
                />
                <PasswordStrengthMeter password={newPassword} />
              </div>
            </div>
            <div className="mail-field-row">
              <div className="mail-secret-field__label-row">
                <label className="mail-field-label" htmlFor="account-confirm-password">Confirm new password</label>
                {passwordMismatch && (
                  <span
                    id="account-confirm-password-error"
                    className="account-password-mismatch text-error"
                    role="alert"
                  >
                    Passwords do not match.
                  </span>
                )}
              </div>
              <Input
                id="account-confirm-password"
                name="confirm-new-password"
                type="password"
                autoComplete="new-password"
                autoCapitalize="off"
                spellCheck={false}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                aria-invalid={passwordMismatch || undefined}
                aria-describedby={passwordMismatch ? "account-confirm-password-error" : undefined}
              />
            </div>
            <div className="mail-transport-footer">
              <Button type="submit" variant="primary" disabled={passwordSaving || !passwordFormValid}>
                Change password
              </Button>
            </div>
          </form>
        </>
      )}
      </Card>
    );
  }

  function renderMfaMethodsList() {
    if (!account) return null;
    if (enrollData || resetFormOpen) return null;
    return (
      <div className="account-mfa-methods">
        {/* ── Authenticator app row ── */}
        <div className="account-mfa-method">
          <span className={`account-mfa-method__icon${totpEnrolled ? " account-mfa-method__icon--ok" : ""}`}>
            <i className="ti ti-shield-lock" aria-hidden="true" />
          </span>
          <div className="account-mfa-method__body">
            <span className="account-mfa-method__name">Authenticator app (TOTP)</span>
            <span className={`account-mfa-method__status${totpEnrolled ? " account-mfa-method__status--ok" : ""}`}>
              {totpEnrolled ? "Enabled" : "Not configured"}
            </span>
          </div>
          {account.has_local_password && (
            <div className="account-mfa-method__action">
              {!totpEnrolled && (
                <Button type="button" variant="primary" size="sm" disabled={mfaEnrolling} onClick={async () => {
                  setMfaEnrolling(true); setTotpCode(""); setUriCopied(false); setShowUriManual(false); setQrRenderFailed(false); setBackupCodesSaved(false);
                  try {
                    await cancelMfaEnroll().catch(() => { /* ignore — no pending enrollment */ });
                    setEnrollData(await enrollMfaTotp());
                  }
                  catch (err) { addToast(operatorApiErrorMessage(err, "Failed to start 2FA setup."), "error"); }
                  finally { setMfaEnrolling(false); }
                }}>Set up</Button>
              )}
              {totpEnrolled && (
                <Button type="button" variant="danger" size="sm" onClick={() => setResetFormOpen(true)}>Reset</Button>
              )}
            </div>
          )}
        </div>
        {/* ── Passkey / WebAuthn placeholder ── */}
        <div className="account-mfa-method account-mfa-method--soon">
          <span className="account-mfa-method__icon">
            <i className="ti ti-fingerprint" aria-hidden="true" />
          </span>
          <div className="account-mfa-method__body">
            <span className="account-mfa-method__name">Passkey / WebAuthn</span>
            <span className="account-mfa-method__status account-mfa-method__status--soon">Coming soon</span>
          </div>
        </div>
        {/* ── Security key placeholder ── */}
        <div className="account-mfa-method account-mfa-method--soon">
          <span className="account-mfa-method__icon">
            <i className="ti ti-key" aria-hidden="true" />
          </span>
          <div className="account-mfa-method__body">
            <span className="account-mfa-method__name">Security key (YubiKey)</span>
            <span className="account-mfa-method__status account-mfa-method__status--soon">Coming soon</span>
          </div>
        </div>
      </div>
    );
  }

  function renderMfaEnrollment() {
    if (!enrollData) return null;
    return (
      <div className="account-2fa-enroll">
        {/* Left column: QR code + copy URI */}
        <div className="account-2fa-enroll__qr">
          <TotpQrCode
            uri={enrollData.otpauthUri}
            onRenderFailed={() => setQrRenderFailed(true)}
            onRenderSuccess={() => setQrRenderFailed(false)}
          />
          <button
            type="button"
            className="account-uri-copy-btn"
            onClick={handleCopyEnrollmentUri}
          >
            <i className={`ti ti-${uriCopied ? "check" : "copy"}`} aria-hidden="true" />
            {uriCopied ? "Copied!" : "Copy URI"}
          </button>
          {(showUriManual || qrRenderFailed) && (
            <code className="account-uri-code account-uri-code--enroll">{enrollData.otpauthUri}</code>
          )}
        </div>
        {/* Right column: hint, backup codes, digit input */}
        <div className="account-2fa-enroll__info">
          <p className="mail-field-hint">Scan the QR code with your authenticator app.</p>
          {renderBackupCodesSection(enrollData)}
          <div className="account-totp-confirm-row__inputs">
            <label className="mail-field-label" htmlFor="account-totp-code">Authenticator code</label>
            <TotpDigitInput
              key={totpInputKey.current}
              id="account-totp-code"
              value={totpCode}
              onChange={setTotpCode}
            />
          </div>
        </div>
      </div>
    );
  }

  function renderMfaResetFields() {
    if (!account?.has_local_password || !totpEnrolled || !resetFormOpen) return null;
    return (
      <>
        <p className="account-info-block">Resetting 2FA removes your authenticator and backup codes, and ends your other active sessions. Your current session stays signed in.</p>
        <div className="account-reset-mfa-fields">
          <div className="mail-field-row">
            <label className="mail-field-label" htmlFor="account-reset-password">Current password</label>
            <Input
              id="account-reset-password"
              name="current-password"
              type="password"
              autoComplete="current-password"
              autoCapitalize="off"
              spellCheck={false}
              value={resetPassword}
              onChange={(e) => setResetPassword(e.target.value)}
            />
          </div>
          {resetCodeRequired && (
            <div className="mail-field-row">
              <label className="mail-field-label" htmlFor="account-reset-code">Authenticator or backup code</label>
              <Input
                id="account-reset-code"
                name="reset-code"
                type="text"
                autoComplete="one-time-code"
                autoCapitalize="off"
                spellCheck={false}
                value={resetCode}
                onChange={(e) => setResetCode(e.target.value)}
                {...stepUpCodeFieldAttrs}
              />
            </div>
          )}
        </div>
      </>
    );
  }

  function renderTwoFactorCard() {
    if (!account) return null;
    return (
      <Card title="Two-factor authentication">
          {/* Methods list — visible only when no active form */}
          {renderMfaMethodsList()}

          {!totpEnrolled && !enrollData && !account.has_local_password && (
            <p className="account-info-block" style={{ marginTop: "var(--space-3)" }}>
              Two-factor setup requires a local password. Sign-in-only accounts must use their identity provider or contact an administrator.
            </p>
          )}

          {renderMfaEnrollment()}
          {renderMfaResetFields()}
          {totpEnrolled && !account.has_local_password && (
            <p className="account-info-block">
              Two-factor reset requires a local password. Sign-in-only accounts must contact an administrator.
            </p>
          )}
          {/* Action footer — aligned to card bottom alongside "Change password" */}
          {enrollData && (
            <div className="mail-transport-footer">
              <Button
                type="button"
                variant="secondary"
                onClick={async () => {
                  totpInputKey.current += 1;
                  setMfaEnrolling(true);
                  setEnrollData(null); setTotpCode(""); setUriCopied(false); setShowUriManual(false); setQrRenderFailed(false); setBackupCodesSaved(false);
                  try { await cancelMfaEnroll(); } catch { /* best-effort */ }
                  finally { setMfaEnrolling(false); }
                }}>Cancel</Button>
              <Button
                type="button"
                variant="primary"
                disabled={
                  mfaConfirming
                  || totpCode.length < 6
                  || (enrollData.backupCodes.length > 0 && !backupCodesSaved)
                }
                onClick={async () => {
                  setMfaConfirming(true);
                  try {
                    await confirmMfaTotp({ code: totpCode });
                    setEnrollData(null); setTotpCode("");
                    addToast("Two-factor authentication is enabled.", "success");
                    await loadAccount();
                  } catch (err) { addToast(operatorApiErrorMessage(err, "Invalid authenticator code."), "error"); }
                  finally { setMfaConfirming(false); }
                }}>Confirm setup</Button>
            </div>
          )}
          {resetFormOpen && (
            <div className="mail-transport-footer">
              <Button type="button" variant="secondary" onClick={() => { setResetFormOpen(false); setResetPassword(""); setResetCode(""); setResetCodeRequired(false); setResetError(null); }}>Cancel</Button>
              <Button type="button" variant="danger" disabled={!resetPassword || (resetCodeRequired && !resetCode)} onClick={() => { setResetError(null); setResetConfirmOpen(true); }}>Reset 2FA</Button>
            </div>
          )}
      </Card>
    );
  }

  function renderSessionsCard() {
    return (
      <Card title="Active sessions" actions={otherSessions.length > 0 ? <Button type="button" variant="danger" size="sm" onClick={() => { setRevokeError(null); setRevokeAllOpen(true); }}>Revoke all other sessions</Button> : undefined}>
        {sessionsLoading && showSessionsSpinner && (
          <div className="sessions-status">
            <Spinner label="Loading sessions" />
          </div>
        )}
        {!sessionsLoading && sessionsError && (
          <div className="sessions-status"><p>{sessionsError}</p><Button type="button" variant="secondary" onClick={() => void loadSessions()}>Retry</Button></div>
        )}
        {!sessionsLoading && !sessionsError && sessions.length === 0 && <p className="sessions-status">No active sessions.</p>}
        {!sessionsLoading && !sessionsError && sessions.length > 0 && (
          <div className="sessions-table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Device</th>
                  <th>IP address</th>
                  <th>Logged in</th>
                  <th>Last active</th>
                  <th>Sign-in</th>
                  <th className="sessions-action-col" aria-label="Actions">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <tr key={s.id}>
                    <td title={s.userAgent ?? undefined}>
                      {s.deviceLabel || parseUserAgent(s.userAgent)}
                      {s.isCurrent && <Badge variant="neutral" className="sessions-current-badge">Current</Badge>}
                    </td>
                    <td>
                      {s.ip ?? "-"}
                      {s.ip && <div className="sessions-subdued"><GeoCell location={s.country} /></div>}
                    </td>
                    <td>
                      {formatSessionPrimaryTime(s.loginAt)}
                      <ActorOrViewerLocalTimeLine
                        iso={s.loginAt}
                        actorTimezone={s.timezone}
                        actorTitle="Signer's local time"
                      />
                    </td>
                    <td>{formatRelativeTime(s.lastSeenAt)}</td>
                    <td>
                      <SessionSignIn authMethod={s.authMethod} />
                    </td>
                    <td>
                      <div className="sessions-row-actions">
                        <SessionRevokeAction
                          session={s}
                          onRevoke={(session) => {
                            setRevokeError(null);
                            setRevokeTarget(session);
                          }}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {revokeError && <p className="sessions-error">{revokeError}</p>}
      </Card>
    );
  }

  return (
    <>
      {!account.roles.some(isUsableRoleAssignment) && (
        <Notice variant="warning" role="alert" className="account-warn-block">
          Your account doesn't have any role assigned yet, so there's nothing to access yet. You can still update your password and two-factor settings below. Contact an administrator to request access.
        </Notice>
      )}
      <Card
        title="Profile"
        actions={
          <AccountIdentityActionsMenu
            account={account}
            moreActions={identityActions}
            onUnlinkClick={() => setUnlinkSsoOpen(true)}
          />
        }
        footer={<div className="mail-transport-footer"><Button type="button" variant="primary" disabled={profileSaving || !profileDirty} onClick={async () => {
        setProfileSaving(true);
        const localeChanged = preferredLocale !== account.preferred_locale;
        try {
          const phoneCountryCodeChanged = phoneCountryCode !== (account.phone_country_code ?? "");
          const phoneNumberChanged = phoneNumber !== (account.phone_number ?? "");
          const result = await patchAccountProfile({
            ...(displayName !== (account.display_name ?? "") && { display_name: displayName }),
            ...(localeChanged && { preferred_locale: preferredLocale }),
            ...(phoneCountryCodeChanged && { phone_country_code: phoneCountryCode }),
            ...(phoneNumberChanged && { phone_number: phoneNumber || null }),
          });
          setDisplayName(result.display_name ?? "");
          setPreferredLocale(result.preferred_locale);
          setPhoneCountryCode(result.phone_country_code ?? "");
          setPhoneNumber(result.phone_number ?? "");
          setPreferredLocaleStore(result.preferred_locale ?? undefined);
          addToast(
            localeChanged
              ? "Profile saved. Reload this page to refresh session timestamps below."
              : "Profile saved.",
            "success",
            localeChanged ? 0 : undefined,
          );
          await loadAccount();
        } catch (err) {
          addToast(operatorApiErrorMessage(err, "Failed to save profile."), "error");
        } finally { setProfileSaving(false); }
      }}>Save</Button></div>}>
        <div className="account-profile-editable">
          <Input
            id="account-display-name"
            label="Display name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            maxLength={120}
            hint={`${displayName.length}/120 characters`}
          />
          <Input id="account-email" label="Email" value={account.email} disabled hint="Email cannot be changed here." />
          <div className="at-field">
            <label className="at-label" htmlFor="account-locale">
              Regional format
            </label>
            <SearchableSelect
              id="account-locale"
              label="Regional format"
              placeholder={`${LOCALE_OPTIONS[0]!.label}: ${LOCALE_OPTIONS[0]!.example}`}
              searchPlaceholder="Search regional formats…"
              emptyLabel="No regional formats found"
              showLabel={false}
              value={preferredLocale ?? "system-default"}
              options={LOCALE_OPTIONS.map((opt) => ({
                id: opt.value ?? "system-default",
                label: `${opt.label}: ${opt.example}`,
              }))}
              disabled={profileSaving}
              onChange={(id) => setPreferredLocale(id === "system-default" ? null : id)}
            />
            <span className="at-hint">
              {`Affects how dates are displayed. Example: ${new Date("2026-06-28T12:00:00Z").toLocaleDateString(preferredLocale ?? undefined, { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" })}. Interface language stays English.`}
            </span>
          </div>
          <div className="at-field">
            <label className="at-label" htmlFor="account-phone-number">Phone number</label>
            <div className="account-phone-row">
              <PhoneCountrySelect
                id="account-phone-country-code"
                label="Phone country code"
                value={phoneCountryCode}
                disabled={profileSaving}
                onChange={setPhoneCountryCode}
              />
              <Input
                id="account-phone-number"
                icon={<i className="ti ti-phone" aria-hidden="true" />}
                type="tel"
                value={phoneNumber}
                disabled={profileSaving}
                onChange={(e) => setPhoneNumber(e.target.value)}
                {...NO_AUTOFILL_PROPS}
              />
            </div>
            <span className="at-hint">For internal contact only - not shown on tickets.</span>
          </div>
          <AccountRoleDisplay account={account} />
          <AccountTypeField account={account} />
        </div>
      </Card>

      <div className="account-security-grid">
        {renderPasswordCard()}
        {renderTwoFactorCard()}
      </div>

      {renderSessionsCard()}

      <ConfirmDialog open={!!revokeTarget} title="Revoke session" message={revokeTarget ? `Revoke this session? Last active ${formatRelativeTime(revokeTarget.lastSeenAt)}.` : ""} confirmLabel="Revoke" confirmVariant="danger" loading={revoking} errorMessage={revokeError ?? undefined} onConfirm={async () => {
        if (!revokeTarget) return;
        setRevoking(true); setRevokeError(null);
        try { await deleteAccountSession(revokeTarget.id); setRevokeTarget(null); await loadSessions(); }
        catch (err) { setRevokeError(operatorApiErrorMessage(err, "Failed to revoke session.")); }
        finally { setRevoking(false); }
      }} onCancel={() => { if (!revoking) { setRevokeTarget(null); setRevokeError(null); } }} />

      <ConfirmDialog open={revokeAllOpen} title="Revoke all other sessions" message={`This will end ${otherSessions.length} other active session${otherSessions.length === 1 ? "" : "s"}.`} confirmLabel="Revoke" confirmVariant="danger" loading={revokeAllBusy} errorMessage={revokeError ?? undefined} onConfirm={async () => {
        setRevokeAllBusy(true); setRevokeError(null);
        try {
          for (const s of otherSessions) await deleteAccountSession(s.id);
          setRevokeAllOpen(false);
          setRevokeError(null);
          await loadSessions();
        } catch (err) {
          setRevokeError(operatorApiErrorMessage(err, "Failed to revoke sessions."));
          await loadSessions();
        } finally { setRevokeAllBusy(false); }
      }} onCancel={() => { if (!revokeAllBusy) { setRevokeAllOpen(false); setRevokeError(null); } }} />

      <ConfirmDialog open={resetConfirmOpen} title="Reset two-factor authentication" message="This removes your authenticator app and all backup codes, and ends your other active sessions. You will stay signed in on this device." confirmLabel="Reset" confirmVariant="danger" loading={resetting} errorMessage={resetError ?? undefined} onConfirm={async () => {
        setResetting(true); setResetError(null);
        try {
          const { sessions_revoked } = await resetMfa({ password: resetPassword, code: resetCode || undefined });
          setResetFormOpen(false); setResetPassword(""); setResetCode(""); setResetCodeRequired(false); setResetConfirmOpen(false);
          const mfaSessionsRevokedPlural = sessions_revoked === 1 ? "" : "s";
          const mfaSessionsRevokedSuffix =
            sessions_revoked > 0 ? ` ${sessions_revoked} other session${mfaSessionsRevokedPlural} ended.` : "";
          addToast(`Two-factor authentication reset.${mfaSessionsRevokedSuffix}`, "success");
          await loadAccount(); await loadSessions();
        }
        catch (err) {
          if (hasApiErrorCode(err, "totp_required")) {
            // The dialog is about to close (progressive disclosure reveals the code field
            // below it instead), so an inline dialog error would never be seen — toast it.
            setResetCodeRequired(true);
            setResetConfirmOpen(false);
            addToast(operatorApiErrorMessage(err, "Failed to reset 2FA."), "info");
          } else {
            setResetError(operatorApiErrorMessage(err, "Failed to reset 2FA."));
          }
        }
        finally { setResetting(false); }
      }} onCancel={() => { if (!resetting) setResetConfirmOpen(false); }} />

      <ConfirmDialog
        open={passwordStepUpOpen}
        title="Enter your authenticator code"
        message="This account requires a second factor to change its password. Enter a code from your authenticator app, or a backup code."
        confirmLabel="Change password"
        confirmVariant="primary"
        loading={passwordSaving}
        errorMessage={passwordCodeError ?? undefined}
        disableConfirm={!passwordCode}
        onConfirm={async () => {
          setPasswordSaving(true);
          setPasswordCodeError(null);
          try {
            await submitPasswordChange(passwordCode);
          } catch (err) {
            if (hasApiErrorCode(err, "invalid_totp")) {
              setPasswordCodeError(operatorApiErrorMessage(err, "Failed to change password."));
            } else {
              setPasswordStepUpOpen(false);
              setPasswordCode("");
              addToast(operatorApiErrorMessage(err, "Failed to change password."), "error");
            }
          } finally {
            setPasswordSaving(false);
          }
        }}
        onCancel={() => {
          if (!passwordSaving) {
            setPasswordStepUpOpen(false);
            setPasswordCode("");
            setPasswordCodeError(null);
          }
        }}
      >
        <div className="mail-field-row">
          <label className="mail-field-label" htmlFor="account-password-code">Authenticator or backup code</label>
          <Input
            id="account-password-code"
            name="password-code"
            type="text"
            autoComplete="one-time-code"
            autoCapitalize="off"
            spellCheck={false}
            value={passwordCode}
            onChange={(e) => setPasswordCode(e.target.value)}
            {...stepUpCodeFieldAttrs}
          />
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={unlinkSsoOpen}
        title="Unlink SSO"
        message="Unlink SSO from your account? Set the new local password you'll sign in with below - your SSO sign-in stops working immediately."
        errorMessage={unlinkSsoError ?? undefined}
        confirmLabel="Unlink"
        confirmVariant="danger"
        loading={unlinkSsoBusy}
        disableConfirm={
          unlinkSsoPassword.length < PASSWORD_MIN_LENGTH ||
          (!!account?.has_local_password && unlinkSsoCurrentPassword.length === 0)
        }
        onConfirm={async () => {
          setUnlinkSsoBusy(true);
          setUnlinkSsoError(null);
          try {
            await submitUnlinkSso();
          } catch (err) {
            if (hasApiErrorCode(err, "totp_required")) {
              setUnlinkSsoOpen(false);
              setUnlinkCodeError(null);
              setUnlinkStepUpOpen(true);
            } else if (err instanceof ApiError && hasApiErrorCode(err, "invalid_request")) {
              setUnlinkSsoError(`Password must be at least ${PASSWORD_MIN_LENGTH} characters.`);
            } else if (hasApiErrorCode(err, "wrong_password") || hasApiErrorCode(err, "current_password_required")) {
              setUnlinkSsoError("Current password is incorrect.");
            } else if (hasApiErrorCode(err, "provider_managed_roles_exist")) {
              setUnlinkSsoOpen(false);
              addToast(
                "Some of your roles are managed by your identity provider. Ask an administrator to remove them before unlinking SSO.",
                "error",
              );
            } else if (hasApiErrorCode(err, "insufficient_verification")) {
              setUnlinkSsoOpen(false);
              addToast(
                "We can't verify it's you without a password or two-factor authentication. Ask an administrator for help unlinking SSO.",
                "error",
              );
            } else {
              setUnlinkSsoError(operatorApiErrorMessage(err, "Failed to unlink SSO."));
            }
          } finally {
            setUnlinkSsoBusy(false);
          }
        }}
        onCancel={() => {
          if (unlinkSsoBusy) return;
          setUnlinkSsoOpen(false);
          setUnlinkSsoPassword("");
          setUnlinkSsoCurrentPassword("");
          setUnlinkSsoError(null);
        }}
      >
        {account?.has_local_password && (
          <Input
            id="unlink-sso-current-password"
            label="Current password"
            icon={<i className="ti ti-lock" aria-hidden="true" />}
            type="password"
            value={unlinkSsoCurrentPassword}
            disabled={unlinkSsoBusy}
            onChange={(e) => setUnlinkSsoCurrentPassword(e.target.value)}
            {...NO_AUTOFILL_PROPS}
          />
        )}
        <Input
          id="unlink-sso-password"
          label="New local password"
          icon={<i className="ti ti-key" aria-hidden="true" />}
          type="password"
          minLength={PASSWORD_MIN_LENGTH}
          hint={`At least ${PASSWORD_MIN_LENGTH} characters.`}
          value={unlinkSsoPassword}
          disabled={unlinkSsoBusy}
          onChange={(e) => setUnlinkSsoPassword(e.target.value)}
          {...NO_AUTOFILL_PROPS}
        />
      </ConfirmDialog>

      <ConfirmDialog
        open={unlinkStepUpOpen}
        title="Enter your authenticator code"
        message="This account requires a second factor to unlink SSO. Enter a code from your authenticator app, or a backup code."
        confirmLabel="Unlink"
        confirmVariant="danger"
        loading={unlinkSsoBusy}
        errorMessage={unlinkCodeError ?? undefined}
        disableConfirm={!unlinkCode}
        onConfirm={async () => {
          setUnlinkSsoBusy(true);
          setUnlinkCodeError(null);
          try {
            await submitUnlinkSso(unlinkCode);
          } catch (err) {
            if (hasApiErrorCode(err, "invalid_totp")) {
              setUnlinkCodeError(operatorApiErrorMessage(err, "Failed to unlink SSO."));
            } else {
              setUnlinkStepUpOpen(false);
              setUnlinkCode("");
              addToast(operatorApiErrorMessage(err, "Failed to unlink SSO."), "error");
            }
          } finally {
            setUnlinkSsoBusy(false);
          }
        }}
        onCancel={() => {
          if (!unlinkSsoBusy) {
            setUnlinkStepUpOpen(false);
            setUnlinkCode("");
            setUnlinkCodeError(null);
          }
        }}
      >
        <div className="mail-field-row">
          <label className="mail-field-label" htmlFor="account-unlink-code">Authenticator or backup code</label>
          <Input
            id="account-unlink-code"
            name="unlink-code"
            type="text"
            autoComplete="one-time-code"
            autoCapitalize="off"
            spellCheck={false}
            value={unlinkCode}
            onChange={(e) => setUnlinkCode(e.target.value)}
            {...stepUpCodeFieldAttrs}
          />
        </div>
      </ConfirmDialog>
    </>
  );
}
