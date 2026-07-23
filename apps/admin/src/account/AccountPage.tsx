import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Badge, Button, Card, Checkbox, Input, PasswordStrengthMeter, Select, Spinner, useToast } from "@admitto/ui";
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
} from "../api/client.js";
import { hasApiErrorCode, operatorApiErrorMessage } from "../api/operator-api-error.js";
import type { AccountDto, MfaEnrollResponse, SessionListDto } from "../api/types.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { formatUtcDateTime } from "../utils/event-dates.js";
import { LOCALE_OPTIONS, setPreferredLocale as setPreferredLocaleStore } from "../utils/locale-store.js";
import { TotpDigitInput } from "./TotpDigitInput.js";
import { TotpQrCode } from "./TotpQrCode.js";

/** Discourage password managers from offering to save a "login" for a TOTP/backup-code field. */
const stepUpCodeFieldAttrs = {
  "data-bwignore": "",
  "data-lpignore": "true",
  "data-1p-ignore": "",
  "data-form-type": "other",
} as const;

function parseUserAgent(ua: string | null): string {
  if (!ua) return "Unknown";
  const browser = matchUaPattern(ua, BROWSER_UA_PATTERNS);
  const os = matchUaPattern(ua, OS_UA_PATTERNS);
  const parts = [browser, os].filter(Boolean);
  return parts.length ? parts.join(" / ") : ua.slice(0, 40);
}

function formatDate(iso: string): string {
  return formatUtcDateTime(iso);
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

const BROWSER_UA_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/Edg\//, "Edge"],
  [/Chrome\//, "Chrome"],
  [/Firefox\//, "Firefox"],
  [/Safari\//, "Safari"],
];

const OS_UA_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/Windows/, "Windows"],
  [/Mac OS X/, "macOS"],
  [/Linux/, "Linux"],
  [/iPhone|iPad/, "iOS"],
];

function matchUaPattern(ua: string, patterns: ReadonlyArray<readonly [RegExp, string]>): string | null {
  for (const [pattern, label] of patterns) {
    if (pattern.test(ua)) return label;
  }
  return null;
}

function signInMethod(account: AccountDto): string {
  const hasOidc = account.roles.some((r) => r.is_oidc);
  if (account.has_local_password && hasOidc) return "Local password + Identity provider";
  if (!account.has_local_password) return "Identity provider (SSO)";
  return "Local password";
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

  const loadAccount = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchAccount(signal);
      setAccount(data);
      setDisplayName(data.display_name ?? "");
      setPreferredLocale(data.preferred_locale);
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

  if (loading) {
    return (
      <Card title="Profile">
        <div className="sessions-status">
          <Spinner label="Loading account" />
        </div>
      </Card>
    );
  }
  if (error || !account) {
    return (
      <Card title="Profile">
        <p role="alert">{error ?? "Failed to load account."}</p>
        <Button type="button" variant="secondary" onClick={() => void loadAccount()}>Retry</Button>
      </Card>
    );
  }

  const totpEnrolled = isTotpEnrolled(account);
  const otherSessions = sessions.filter((s) => !s.isCurrent);
  const profileDirty =
    displayName !== (account.display_name ?? "") ||
    preferredLocale !== account.preferred_locale;
  const passwordMismatch =
    confirmPassword.length > 0 && newPassword.length > 0 && confirmPassword !== newPassword;
  const passwordFormValid =
    currentPassword.length > 0 &&
    newPassword.length >= 12 &&
    confirmPassword.length > 0 &&
    !passwordMismatch;

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

  function renderBackupCodesSection(enrollment: MfaEnrollResponse): ReactNode {
    if (enrollment.backupCodes.length > 0) {
      return (
        <div className="account-auth-backup">
          <div className="account-auth-backup__head">
            <strong>Backup codes — save all 10, shown once</strong>
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
      <Card title="Password">
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
            <div className="account-warn-block" role="alert">You are required to change your password.</div>
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
              <label className="mail-field-label" htmlFor="account-confirm-password">Confirm new password</label>
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
              {passwordMismatch && (
                <p id="account-confirm-password-error" className="text-error" role="alert">
                  Passwords do not match.
                </p>
              )}
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
            onClick={() => {
              void copyTextToClipboard(enrollData.otpauthUri).then((ok) => {
                if (ok) {
                  if (!qrRenderFailed) setShowUriManual(false);
                  setUriCopied(true);
                  setTimeout(() => setUriCopied(false), 2000);
                } else {
                  setShowUriManual(true);
                }
              });
            }}
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
    if (!account || !account.has_local_password || !totpEnrolled || !resetFormOpen) return null;
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
        {sessionsLoading && (
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
              <thead><tr><th>Device</th><th>IP</th><th>Login at</th><th>Last seen</th><th>Auth method</th><th>Action</th></tr></thead>
              <tbody>
                {sessions.map((s) => (
                  <tr key={s.id}>
                    <td title={s.userAgent ?? undefined}>
                      {s.deviceLabel || parseUserAgent(s.userAgent)}
                      {s.isCurrent && <Badge variant="neutral" className="sessions-current-badge">Current</Badge>}
                    </td>
                    <td>{s.ip ?? "—"}</td>
                    <td>{formatDate(s.loginAt)}</td>
                    <td>{formatDate(s.lastSeenAt)}</td>
                    <td>{s.authMethod === "oidc" ? "OIDC" : "Local"}</td>
                    <td>
                      {s.isCurrent ? (
                        <Button type="button" variant="danger" disabled title="Cannot revoke current session">Revoke</Button>
                      ) : (
                        <Button type="button" variant="danger" onClick={() => { setRevokeError(null); setRevokeTarget(s); }}>Revoke</Button>
                      )}
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
      <Card title="Profile" footer={<div className="mail-transport-footer"><Button type="button" variant="primary" disabled={profileSaving || !profileDirty} onClick={async () => {
        setProfileSaving(true);
        const localeChanged = preferredLocale !== account.preferred_locale;
        try {
          const result = await patchAccountProfile({
            ...(displayName !== (account.display_name ?? "") && { display_name: displayName }),
            ...(localeChanged && { preferred_locale: preferredLocale }),
          });
          setDisplayName(result.display_name ?? "");
          setPreferredLocale(result.preferred_locale);
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
        <div className="account-profile-grid">
          <div className="account-profile-editable">
            <div className="mail-field-row">
              <label className="mail-field-label" htmlFor="account-display-name">Display name</label>
              <Input id="account-display-name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={120} />
              <p className="mail-field-hint">{displayName.length}/120 characters</p>
            </div>
            <Select
              id="account-locale"
              label="Regional format"
              value={preferredLocale ?? ""}
              onChange={(e) => setPreferredLocale(e.target.value || null)}
              disabled={profileSaving}
              hint={`Affects how dates are displayed. Example: ${new Date("2026-06-28T12:00:00Z").toLocaleDateString(preferredLocale ?? undefined, { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" })}. Interface language stays English.`}
            >
              {LOCALE_OPTIONS.map((opt) => (
                <option key={opt.value ?? "_system"} value={opt.value ?? ""}>
                  {opt.label} — {opt.example}
                </option>
              ))}
            </Select>
          </div>
          <dl className="account-info-rows">
            <div className="account-info-row">
              <dt>Email</dt>
              <dd>
                <span>{account.email}</span>
                <span className="account-info-hint">Email cannot be changed here.</span>
              </dd>
            </div>
            <div className="account-info-row">
              <dt>Sign-in</dt>
              <dd><span>{signInMethod(account)}</span></dd>
            </div>
            {account.roles.length > 0 && (
              <div className="account-info-row">
                <dt>Roles</dt>
                <dd>
                  <div className="account-role-list">
                    {account.roles.map((r) => (
                      <Badge key={r.id} variant="neutral">{r.role}{r.is_oidc ? " (IdP)" : ""}</Badge>
                    ))}
                  </div>
                  <span className="account-info-hint">Roles are read-only. Contact an administrator to change access.</span>
                </dd>
              </div>
            )}
          </dl>
        </div>
      </Card>

      <div className="account-security-grid">
        {renderPasswordCard()}
        {renderTwoFactorCard()}
      </div>

      {renderSessionsCard()}

      <ConfirmDialog open={!!revokeTarget} title="Revoke session" message={revokeTarget ? `Revoke this session? Last active ${formatDate(revokeTarget.lastSeenAt)}.` : ""} confirmLabel="Revoke" confirmVariant="danger" loading={revoking} errorMessage={revokeError ?? undefined} onConfirm={async () => {
        if (!revokeTarget) return;
        setRevoking(true); setRevokeError(null);
        try { await deleteAccountSession(revokeTarget.id); setRevokeTarget(null); await loadSessions(); }
        catch (err) { setRevokeError(operatorApiErrorMessage(err, "Failed to revoke session.")); }
        finally { setRevoking(false); }
      }} onCancel={() => { if (!revoking) { setRevokeTarget(null); setRevokeError(null); } }} />

      <ConfirmDialog open={revokeAllOpen} title="Revoke all other sessions" message={`This will end ${otherSessions.length} other active session${otherSessions.length === 1 ? "" : "s"}.`} confirmLabel="Revoke all" confirmVariant="danger" loading={revokeAllBusy} errorMessage={revokeError ?? undefined} onConfirm={async () => {
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

      <ConfirmDialog open={resetConfirmOpen} title="Reset two-factor authentication" message="This removes your authenticator app and all backup codes, and ends your other active sessions. You will stay signed in on this device." confirmLabel="Reset 2FA" confirmVariant="danger" loading={resetting} errorMessage={resetError ?? undefined} onConfirm={async () => {
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
    </>
  );
}
