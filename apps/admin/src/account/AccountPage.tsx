import { useCallback, useEffect, useRef, useState } from "react";
import { Badge, Button, Card, Input, PasswordStrengthMeter, Spinner, useToast } from "@admitto/ui";
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
import { operatorApiErrorMessage } from "../api/operator-api-error.js";
import type { AccountDto, MfaEnrollResponse, SessionListDto } from "../api/types.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { formatUtcDateTime } from "../utils/event-dates.js";
import { LOCALE_OPTIONS, setPreferredLocale as setPreferredLocaleStore } from "../utils/locale-store.js";
import { TotpDigitInput } from "./TotpDigitInput.js";
import { TotpQrCode } from "./TotpQrCode.js";

function parseUserAgent(ua: string | null): string {
  if (!ua) return "Unknown";
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : null;
  const os = /Windows/.test(ua) ? "Windows" : /Mac OS X/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : /iPhone|iPad/.test(ua) ? "iOS" : null;
  const parts = [browser, os].filter(Boolean);
  return parts.length ? parts.join(" / ") : ua.slice(0, 40);
}

function formatDate(iso: string): string {
  return formatUtcDateTime(iso);
}

function isTotpEnrolled(account: AccountDto): boolean {
  return account.mfa_methods.some((m) => m.type === "totp" && m.confirmed);
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
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [enrollData, setEnrollData] = useState<MfaEnrollResponse | null>(null);
  const [totpCode, setTotpCode] = useState("");
  const totpInputKey = useRef(0);
  const [mfaEnrolling, setMfaEnrolling] = useState(false);
  const [mfaConfirming, setMfaConfirming] = useState(false);
  const [resetFormOpen, setResetFormOpen] = useState(false);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [resetPassword, setResetPassword] = useState("");
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
            <div className="mail-field-row">
              <label className="mail-field-label" htmlFor="account-locale">Regional format</label>
              <select
                id="account-locale"
                className="at-select"
                value={preferredLocale ?? ""}
                onChange={(e) => setPreferredLocale(e.target.value || null)}
                disabled={profileSaving}
                aria-describedby="account-locale-hint"
              >
                {LOCALE_OPTIONS.map((opt) => (
                  <option key={opt.value ?? "_system"} value={opt.value ?? ""}>
                    {opt.label} — {opt.example}
                  </option>
                ))}
              </select>
              <p className="mail-field-hint" id="account-locale-hint">
                {`Affects how dates are displayed. Example: ${new Date("2026-06-28T12:00:00Z").toLocaleDateString(preferredLocale ?? undefined, { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" })}. Interface language stays English.`}
              </p>
            </div>
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
                  const { sessions_revoked } = await patchAccountPassword({
                    current_password: currentPassword,
                    new_password: newPassword,
                    new_password_confirm: confirmPassword,
                  });
                  setCurrentPassword("");
                  setNewPassword("");
                  setConfirmPassword("");
                  addToast(
                    `Password changed.${sessions_revoked > 0 ? ` ${sessions_revoked} other session${sessions_revoked === 1 ? "" : "s"} revoked.` : ""}`,
                    "success",
                  );
                  await loadAccount();
                  await loadSessions();
                } catch (err) {
                  addToast(operatorApiErrorMessage(err, "Failed to change password."), "error");
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
        <Card title="Two-factor authentication">
            {/* Methods list — always visible */}
            <div className="account-mfa-methods">
              {/* ── Authenticator app row ── */}
              <div className="account-mfa-method">
                <span className="account-mfa-method__icon">
                  <i className="ti ti-shield-lock" aria-hidden="true" />
                </span>
                <div className="account-mfa-method__body">
                  <span className="account-mfa-method__name">Authenticator app (TOTP)</span>
                  <span className={`account-mfa-method__status${totpEnrolled ? " account-mfa-method__status--ok" : ""}`}>
                    {totpEnrolled ? "Enabled" : "Not configured"}
                  </span>
                </div>
                {!enrollData && account.has_local_password && (
                  <div className="account-mfa-method__action">
                    {!totpEnrolled && (
                      <Button type="button" variant="primary" size="sm" disabled={mfaEnrolling} onClick={async () => {
                        setMfaEnrolling(true); setTotpCode(""); setUriCopied(false);
                        try {
                          await cancelMfaEnroll().catch(() => { /* ignore — no pending enrollment */ });
                          setEnrollData(await enrollMfaTotp());
                        }
                        catch (err) { addToast(operatorApiErrorMessage(err, "Failed to start 2FA setup."), "error"); }
                        finally { setMfaEnrolling(false); }
                      }}>Set up</Button>
                    )}
                    {totpEnrolled && !resetFormOpen && (
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

            {!totpEnrolled && !enrollData && !account.has_local_password && (
              <p className="account-info-block" style={{ marginTop: "var(--space-3)" }}>
                Two-factor setup requires a local password. Sign-in-only accounts must use their identity provider or contact an administrator.
              </p>
            )}

            {enrollData && (
              <div className="account-2fa-enroll">
                {/* Left column: QR code + copy URI */}
                <div className="account-2fa-enroll__qr">
                  <TotpQrCode uri={enrollData.otpauthUri} />
                  <button
                    type="button"
                    className="account-uri-copy-btn"
                    onClick={() => {
                      navigator.clipboard.writeText(enrollData.otpauthUri).then(() => {
                        setUriCopied(true);
                        setTimeout(() => setUriCopied(false), 2000);
                      }).catch(() => {});
                    }}
                  >
                    <i className={`ti ti-${uriCopied ? "check" : "copy"}`} aria-hidden="true" />
                    {uriCopied ? "Copied!" : "Copy URI"}
                  </button>
                </div>
                {/* Right column: all setup info stacked */}
                <div className="account-2fa-enroll__info">
                  <p className="mail-field-hint">Scan the QR code with your authenticator app.</p>
                  {enrollData.backupCodes.length > 0 ? (
                    <div className="account-auth-backup">
                      <strong>Backup codes — save all 10, shown once</strong>
                      <ul>{enrollData.backupCodes.map((code) => <li key={code}><code>{code}</code></li>)}</ul>
                    </div>
                  ) : enrollData.backupCodesAlreadyShown ? (
                    <p className="mail-field-hint">Backup codes were shown at first setup. Use your saved codes if you need to recover access.</p>
                  ) : null}
                  <div className="account-totp-confirm-row">
                    <div className="account-totp-confirm-row__inputs">
                      <label className="mail-field-label" htmlFor="account-totp-code">Authenticator code</label>
                      <TotpDigitInput
                        key={totpInputKey.current}
                        id="account-totp-code"
                        value={totpCode}
                        onChange={setTotpCode}
                      />
                    </div>
                    <div className="account-enroll-actions">
                      <Button
                        type="button"
                        variant="primary"
                        disabled={mfaConfirming || totpCode.length < 6}
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
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={async () => {
                          totpInputKey.current += 1;
                          setMfaEnrolling(true);
                          setEnrollData(null); setTotpCode(""); setUriCopied(false);
                          try { await cancelMfaEnroll(); } catch { /* best-effort */ }
                          finally { setMfaEnrolling(false); }
                        }}>Cancel</Button>
                    </div>
                  </div>
                </div>
              </div>
            )}
            {totpEnrolled && account.has_local_password && (
              <>
                <p className="account-info-block" style={{ marginTop: "var(--space-3)" }}>Resetting 2FA will end your other active sessions. You will need to sign in again.</p>
                {resetFormOpen && (
                  <>
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
                    <div className="account-enroll-actions">
                      <Button type="button" variant="danger" disabled={!resetPassword} onClick={() => setResetConfirmOpen(true)}>Reset 2FA</Button>
                      <Button type="button" variant="secondary" onClick={() => { setResetFormOpen(false); setResetPassword(""); setResetError(null); }}>Cancel</Button>
                    </div>
                  </>
                )}
              </>
            )}
            {totpEnrolled && !account.has_local_password && (
              <p className="account-info-block">
                Two-factor reset requires a local password. Sign-in-only accounts must contact an administrator.
              </p>
            )}
        </Card>
      </div>

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

      <ConfirmDialog open={resetConfirmOpen} title="Reset two-factor authentication" message="This removes your authenticator app and all backup codes, and ends your other active sessions. You will need to sign in again." confirmLabel="Reset 2FA" confirmVariant="danger" loading={resetting} errorMessage={resetError ?? undefined} onConfirm={async () => {
        setResetting(true); setResetError(null);
        try {
          const { sessions_revoked } = await resetMfa({ password: resetPassword });
          setResetFormOpen(false); setResetPassword(""); setResetConfirmOpen(false);
          addToast(
            `Two-factor authentication reset.${sessions_revoked > 0 ? ` ${sessions_revoked} other session${sessions_revoked === 1 ? "" : "s"} ended.` : ""}`,
            "success",
          );
          await loadAccount(); await loadSessions();
        }
        catch (err) { setResetError(operatorApiErrorMessage(err, "Failed to reset 2FA.")); }
        finally { setResetting(false); }
      }} onCancel={() => { if (!resetting) setResetConfirmOpen(false); }} />
    </>
  );
}
