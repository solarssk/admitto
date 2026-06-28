import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Card, Checkbox, Input, Spinner } from "@admitto/ui";
import {
  ApiError,
  confirmMfaTotp,
  deleteAccountSession,
  enrollMfaTotp,
  fetchAccount,
  fetchAccountSessions,
  patchAccountPassword,
  patchAccountProfile,
  resetMfa,
} from "../api/client.js";
import type { AccountDto, MfaEnrollResponse, SessionListDto } from "../api/types.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { formatUtcDateTime } from "../utils/event-dates.js";
import { LOCALE_OPTIONS, setPreferredLocale as setPreferredLocaleStore } from "../utils/locale-store.js";

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

function redirectToLoginIfUnauthorized(err: unknown): boolean {
  if (err instanceof ApiError && err.status === 401) {
    const next = encodeURIComponent(window.location.pathname);
    window.location.assign(`/login?next=${next}`);
    return true;
  }
  return false;
}

export function AccountPage() {
  const [account, setAccount] = useState<AccountDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [preferredLocale, setPreferredLocale] = useState<string | null>(null);
  const [localeSaved, setLocaleSaved] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileStatus, setProfileStatus] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordStatus, setPasswordStatus] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [enrollData, setEnrollData] = useState<MfaEnrollResponse | null>(null);
  const [backupSaved, setBackupSaved] = useState(false);
  const [totpCode, setTotpCode] = useState("");
  const [mfaEnrolling, setMfaEnrolling] = useState(false);
  const [mfaConfirming, setMfaConfirming] = useState(false);
  const [mfaError, setMfaError] = useState<string | null>(null);
  const [mfaStatus, setMfaStatus] = useState<string | null>(null);
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
      setError(err instanceof ApiError ? err.message : "Failed to load account.");
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
      setSessionsError(err instanceof ApiError ? err.message : "Failed to load sessions.");
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
        setProfileSaving(true); setProfileError(null); setProfileStatus(null); setLocaleSaved(false);
        try {
          const result = await patchAccountProfile({
            ...(displayName !== (account.display_name ?? "") && { display_name: displayName }),
            ...(preferredLocale !== account.preferred_locale && { preferred_locale: preferredLocale }),
          });
          setDisplayName(result.display_name ?? "");
          setPreferredLocale(result.preferred_locale);
          setPreferredLocaleStore(result.preferred_locale ?? undefined);
          setProfileStatus("Profile saved.");
          if (preferredLocale !== account.preferred_locale) setLocaleSaved(true);
          await loadAccount();
        } catch (err) {
          setProfileError(err instanceof ApiError ? err.message : "Failed to save profile.");
        } finally { setProfileSaving(false); }
      }}>Save</Button></div>}>
        <div className="mail-field-row">
          <label className="mail-field-label" htmlFor="account-display-name">Display name</label>
          <Input id="account-display-name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={120} />
          <p className="mail-field-hint">{displayName.length}/120 characters</p>
        </div>
        <div className="mail-field-row">
          <label className="mail-field-label" htmlFor="account-locale">Date format</label>
          <select
            id="account-locale"
            className="form-select"
            value={preferredLocale ?? ""}
            onChange={(e) => {
              setLocaleSaved(false);
              setPreferredLocale(e.target.value || null);
            }}
            disabled={profileSaving}
          >
            {LOCALE_OPTIONS.map((opt) => (
              <option key={opt.value ?? "_system"} value={opt.value ?? ""}>
                {opt.label} — {opt.example}
              </option>
            ))}
          </select>
          <p className="mail-field-hint">
            How dates are displayed in the admin panel. Example:{" "}
            <strong>
              {new Date("2026-06-28T12:00:00Z").toLocaleDateString(
                preferredLocale ?? undefined,
                { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" },
              )}
            </strong>
          </p>
        </div>
        <div className="mail-field-row">
          <span className="mail-field-label">Email</span>
          <p className="account-readonly-field">{account.email}</p>
          <p className="mail-field-hint">Email cannot be changed here.</p>
        </div>
        {account.roles.length > 0 && (
          <div className="mail-field-row">
            <span className="mail-field-label">Roles</span>
            <div className="account-role-list">
              {account.roles.map((r) => (
                <Badge key={r.id} variant="neutral">{r.role}{r.is_oidc ? " (IdP)" : ""}</Badge>
              ))}
            </div>
            <p className="account-role-hint">Roles are read-only. Contact an administrator to change access.</p>
          </div>
        )}
        {profileError && <p className="text-error" role="alert">{profileError}</p>}
        {profileStatus && <p className="text-success" role="status">{profileStatus}</p>}
        {localeSaved && (
          <p className="mail-field-hint" style={{ color: "var(--success)" }}>
            Saved. Most views use the new format immediately; reload this page to refresh session timestamps below.
          </p>
        )}
      </Card>

      <Card title="Password">
        {!account.has_local_password ? (
          <p className="account-info-block">Password is managed by your identity provider.</p>
        ) : (
          <>
            {account.must_change_password && (
              <div className="account-warn-block" role="alert">You are required to change your password.</div>
            )}
            <div className="mail-field-row">
              <label className="mail-field-label" htmlFor="account-current-password">Current password</label>
              <Input id="account-current-password" type="password" autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
            </div>
            <div className="mail-field-row">
              <label className="mail-field-label" htmlFor="account-new-password">New password</label>
              <Input id="account-new-password" type="password" autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} minLength={12} />
              <p className="mail-field-hint">Minimum 12 characters.</p>
            </div>
            <div className="mail-field-row">
              <label className="mail-field-label" htmlFor="account-confirm-password">Confirm new password</label>
              <Input id="account-confirm-password" type="password" autoComplete="new-password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} aria-invalid={passwordMismatch || undefined} />
              {passwordMismatch && (
                <p className="text-error" role="alert">Passwords do not match.</p>
              )}
            </div>
            <div className="mail-transport-footer">
              <Button type="button" variant="primary" disabled={passwordSaving || !passwordFormValid} onClick={async () => {
                setPasswordSaving(true); setPasswordError(null); setPasswordStatus(null);
                try {
                  const { sessions_revoked } = await patchAccountPassword({ current_password: currentPassword, new_password: newPassword, new_password_confirm: confirmPassword });
                  setCurrentPassword(""); setNewPassword(""); setConfirmPassword("");
                  setPasswordStatus(`Password changed.${sessions_revoked > 0 ? ` ${sessions_revoked} other session${sessions_revoked === 1 ? "" : "s"} revoked.` : ""}`);
                  await loadAccount(); await loadSessions();
                } catch (err) {
                  setPasswordError(err instanceof ApiError ? err.message : "Failed to change password.");
                } finally { setPasswordSaving(false); }
              }}>Change password</Button>
            </div>
            {passwordError && <p className="text-error" role="alert">{passwordError}</p>}
            {passwordStatus && <p className="text-success" role="status">{passwordStatus}</p>}
          </>
        )}
      </Card>

      <Card title="Two-factor authentication">
        <div className="account-mfa-status">
          <Badge variant={totpEnrolled ? "ok" : "neutral"}>{totpEnrolled ? "Enabled" : "Not configured"}</Badge>
        </div>
        {!totpEnrolled && !enrollData && account.has_local_password && (
          <Button type="button" variant="primary" disabled={mfaEnrolling} onClick={async () => {
            setMfaEnrolling(true); setMfaError(null); setMfaStatus(null); setBackupSaved(false); setTotpCode("");
            try { setEnrollData(await enrollMfaTotp()); }
            catch (err) { setMfaError(err instanceof ApiError ? err.message : "Failed to start 2FA setup."); }
            finally { setMfaEnrolling(false); }
          }}>Set up authenticator</Button>
        )}
        {!totpEnrolled && !enrollData && !account.has_local_password && (
          <p className="account-info-block">
            Two-factor setup requires a local password. Sign-in-only accounts must use their identity provider or contact an administrator.
          </p>
        )}
        {enrollData && (
          <>
            <p className="mail-field-hint">Scan this URI in your authenticator app:</p>
            <code className="account-uri-code">{enrollData.otpauthUri}</code>
            {enrollData.backupCodes.length > 0 ? (
              <div className="account-auth-backup">
                <strong>Backup codes</strong>
                <p className="mail-field-hint">Save these codes somewhere safe. They are shown only once.</p>
                <ul>{enrollData.backupCodes.map((code) => <li key={code}><code>{code}</code></li>)}</ul>
              </div>
            ) : enrollData.backupCodesAlreadyShown ? (
              <p className="mail-field-hint">Backup codes were already shown. Use your saved codes if needed.</p>
            ) : null}
            <label className="account-checkbox-row">
              <Checkbox checked={backupSaved} onChange={(e) => setBackupSaved(e.target.checked)} />
              <span>I&apos;ve saved my backup codes</span>
            </label>
            <div className="mail-field-row">
              <label className="mail-field-label" htmlFor="account-totp-code">Authenticator code</label>
              <Input id="account-totp-code" value={totpCode} onChange={(e) => setTotpCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" disabled={!backupSaved && enrollData.backupCodes.length > 0} />
            </div>
            <div className="account-enroll-actions">
              <Button type="button" variant="primary" disabled={mfaConfirming || !totpCode.trim() || (!backupSaved && enrollData.backupCodes.length > 0)} onClick={async () => {
                setMfaConfirming(true); setMfaError(null);
                try {
                  await confirmMfaTotp({ code: totpCode.trim() });
                  setEnrollData(null); setTotpCode(""); setBackupSaved(false);
                  setMfaStatus("Two-factor authentication is enabled.");
                  await loadAccount();
                } catch (err) { setMfaError(err instanceof ApiError ? err.message : "Invalid authenticator code."); }
                finally { setMfaConfirming(false); }
              }}>Confirm setup</Button>
              <Button type="button" variant="secondary" onClick={() => setEnrollData(null)}>Cancel</Button>
            </div>
          </>
        )}
        {totpEnrolled && account.has_local_password && (
          <>
            <p className="account-info-block">Resetting 2FA will end your other active sessions. You will stay signed in on this device.</p>
            {!resetFormOpen ? (
              <Button type="button" variant="danger" onClick={() => setResetFormOpen(true)}>Reset 2FA</Button>
            ) : (
              <>
                <div className="mail-field-row">
                  <label className="mail-field-label" htmlFor="account-reset-password">Current password</label>
                  <Input id="account-reset-password" type="password" autoComplete="current-password" value={resetPassword} onChange={(e) => setResetPassword(e.target.value)} />
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
        {mfaError && <p className="text-error" role="alert">{mfaError}</p>}
        {mfaStatus && <p className="text-success" role="status">{mfaStatus}</p>}
      </Card>

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
        catch (err) { setRevokeError(err instanceof ApiError ? err.message : "Failed to revoke session."); }
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
          setRevokeError(err instanceof ApiError ? err.message : "Failed to revoke sessions.");
          await loadSessions();
        } finally { setRevokeAllBusy(false); }
      }} onCancel={() => { if (!revokeAllBusy) { setRevokeAllOpen(false); setRevokeError(null); } }} />

      <ConfirmDialog open={resetConfirmOpen} title="Reset two-factor authentication" message="This removes your authenticator and ends other active sessions. You will stay signed in here." confirmLabel="Reset 2FA" confirmVariant="danger" loading={resetting} errorMessage={resetError ?? undefined} onConfirm={async () => {
        setResetting(true); setResetError(null);
        try {
          const { sessions_revoked } = await resetMfa({ password: resetPassword });
          setResetFormOpen(false); setResetPassword(""); setResetConfirmOpen(false);
          setMfaStatus(
            `Two-factor authentication reset.${sessions_revoked > 0 ? ` ${sessions_revoked} other session${sessions_revoked === 1 ? "" : "s"} ended.` : ""}`,
          );
          await loadAccount(); await loadSessions();
        }
        catch (err) { setResetError(err instanceof ApiError ? err.message : "Failed to reset 2FA."); }
        finally { setResetting(false); }
      }} onCancel={() => { if (!resetting) setResetConfirmOpen(false); }} />
    </>
  );
}
