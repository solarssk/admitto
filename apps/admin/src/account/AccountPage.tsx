import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { startRegistration } from "@simplewebauthn/browser";
import { Badge, Button, Card, Checkbox, EmptyState, HintLabel, Input, Notice, PasswordStrengthMeter, Spinner, useToast } from "@admitto/ui";
import {
  ApiError,
  beginWebauthnRegistration,
  cancelMfaEnroll,
  confirmMfaTotp,
  deleteAccountSession,
  deleteAccountTotp,
  deleteWebauthnCredential,
  enrollMfaTotp,
  fetchAccount,
  fetchAccountSessions,
  fetchBackupCodesStatus,
  finishWebauthnRegistration,
  forgetAllTrustedDevices,
  patchAccountPassword,
  patchAccountProfile,
  regenerateBackupCodes,
  resetMfa,
  unlinkAccountExternalIdentity,
} from "../api/client.js";
import { hasApiErrorCode, operatorApiErrorMessage } from "../api/operator-api-error.js";
import { BACKUP_RECOVERY_CODE_COUNT, PASSWORD_MIN_LENGTH } from "@admitto/auth/constants";
import type {
  AccountDto,
  AccountMfaMethodDto,
  AccountRoleDto,
  BackupCodesStatusResponse,
  MfaEnrollResponse,
  SessionListDto,
  StepUpProofBody,
  WebauthnAttachment,
} from "../api/types.js";
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
import {
  LOCALE_OPTIONS,
  setPreferredLocale as setPreferredLocaleStore,
  setPreferredTimeFormat as setPreferredTimeFormatStore,
} from "../utils/locale-store.js";
import { parseUserAgent } from "../utils/parseUserAgent.js";
import { TotpDigitInput } from "./TotpDigitInput.js";
import { TotpQrCode } from "./TotpQrCode.js";
import { WebauthnStepUpButton } from "./WebauthnStepUpButton.js";

const PASSWORD_HINT = "Changing your password ends your other active sessions. Your current session stays signed in.";
const TIME_FORMAT_OPTIONS = [
  { id: "system-default", label: "System default (browser)" },
  { id: "24h", label: "24-hour time (13:30)" },
  { id: "12h", label: "12-hour time (1:30 PM)" },
] as const;

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

/** Whether the account has at least one confirmed passkey/security key - used to gate the Backup
 * codes row (decision 6: codes only exist once there's a first confirmed MFA method of any kind). */
function hasConfirmedWebauthnMethod(account: AccountDto): boolean {
  return account.mfa_methods.some((m) => m.type === "webauthn" && m.confirmed);
}

/** Registered passkeys ("platform") or security keys ("cross-platform") - GET /api/account's own
 * mfa_methods already carries id/label/attachment for webauthn rows, so no separate fetch/state is
 * needed here; loadAccount() already refreshes this list after every mutation. */
function webauthnCredentials(account: AccountDto, attachment: WebauthnAttachment): AccountMfaMethodDto[] {
  return account.mfa_methods.filter((m) => m.type === "webauthn" && m.attachment === attachment);
}

/** Friendly text for a failed browser WebAuthn ceremony (not an API error) - covers the common
 * case (the user closed the prompt, or it timed out; every browser surfaces this as
 * `NotAllowedError`) plus an abort, with one generic fallback for anything else (unsupported
 * browser, hardware/security error). Never surfaces the raw DOMException/WebAuthnError text. */
function webauthnCeremonyErrorMessage(err: unknown): string {
  const name = err instanceof Error ? err.name : undefined;
  if (name === "NotAllowedError" || name === "AbortError") return "Setup was cancelled.";
  return "Could not complete the setup in your browser. Try again.";
}

/** Confirm-removal question for a passkey/security key. Whether it's the account's last
 * confirmed MFA method (across TOTP and WebAuthn together) is surfaced separately as a Notice
 * (see isLastConfirmedMfaMethod) rather than folded into this string. */
function removeCredentialMessage(target: AccountMfaMethodDto): string {
  const kind = target.attachment === "platform" ? "passkey" : "security key";
  const label = target.label ? `"${target.label}"` : `this ${kind}`;
  return `Remove ${label}? You can register another ${kind} any time.`;
}

/** True when removing `target` would leave the account with zero confirmed MFA methods. Purely
 * informational: packages/auth/src/login.ts already routes a zero-method MFA-required account to
 * ENROLLMENT_REQUIRED on next login, the same safe path a brand-new account takes. */
function isLastConfirmedMfaMethod(target: AccountMfaMethodDto, account: AccountDto): boolean {
  return account.mfa_methods.filter((m) => m.confirmed).length - 1 <= 0 && !!target.confirmed;
}

function accountTypeHint(account: AccountDto, isManaged: boolean): string {
  if (!isManaged) return "Signed in with a password you set. Manage it in the Password section below.";
  if (account.has_local_password) {
    return "Signed in through your organization's identity provider, with a local password available as a fallback. Manage it in the Password section below.";
  }
  return "Signed in through your organization's identity provider. Password and two-factor authentication are managed there.";
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
      <p className="sr-only">{hint}</p>
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

/** Kebab menu in the "Two-factor authentication" card header - holds account-wide actions kept
 * out of the per-method Manage popups above so they don't read as belonging to any one method:
 * forgetting every device this account ever chose to remember (disabled once there are none
 * left to forget), and, additionally, the account-wide "Reset everything" action (clears TOTP,
 * every passkey/security key, and all backup codes together) once the account also has a local
 * password to reset with. Self-contained (calls useDropdownMenu itself, same as
 * HealthCheckMoreActions) since nothing else in the card needs its open state. */
function TwoFactorMoreActions({
  onReset,
  onForgetDevices,
  showReset,
  trustedDevicesCount,
}: Readonly<{
  onReset: () => void;
  onForgetDevices: () => void;
  showReset: boolean;
  trustedDevicesCount: number;
}>) {
  const { open, setOpen, close, panelStyle, rootRef, triggerRef, panelRef } = useDropdownMenu<HTMLButtonElement>({
    align: "end",
  });

  return (
    <div className="more-actions-menu" ref={rootRef}>
      <button
        type="button"
        ref={triggerRef}
        className="at-iconbtn at-iconbtn--sm"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Two-factor authentication options"
        onClick={() => setOpen((o) => !o)}
      >
        <i className="ti ti-dots-vertical" aria-hidden="true" />
      </button>
      {open && (
        <div className="more-actions-menu__panel" role="menu" ref={panelRef} style={panelStyle}>
          <MoreActionsMenuItem
            icon="devices-off"
            label="Forget all trusted devices"
            hint="You'll be asked to verify again on every device next time"
            disabled={trustedDevicesCount === 0}
            tooltip={trustedDevicesCount === 0 ? "No devices are currently remembered." : undefined}
            onClick={() => {
              close();
              onForgetDevices();
            }}
          />
          {showReset && (
            <MoreActionsMenuItem
              icon="refresh"
              label="Reset everything"
              hint="Remove every 2FA method and end your other sessions"
              variant="danger"
              onClick={() => {
                close();
                onReset();
              }}
            />
          )}
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
      <p className="sr-only">Only an administrator can change this. {ROLE_ACCESS_DESCRIPTION[primary.role]}</p>
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
  const [preferredTimeFormat, setPreferredTimeFormat] = useState<"12h" | "24h" | null>(null);
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
  const [forgetDevicesOpen, setForgetDevicesOpen] = useState(false);
  const [forgetDevicesBusy, setForgetDevicesBusy] = useState(false);
  const [forgetDevicesError, setForgetDevicesError] = useState<string | null>(null);
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
  const [addPasskeyOpen, setAddPasskeyOpen] = useState(false);
  const [addPasskeyLabel, setAddPasskeyLabel] = useState("");
  const [addingPasskey, setAddingPasskey] = useState(false);
  const [addPasskeyError, setAddPasskeyError] = useState<string | null>(null);
  // Non-null only when this passkey was the account's first-ever confirmed MFA method, so the
  // server minted a fresh batch of backup codes as a side effect - the only plaintext copy ever
  // shown. Kept separate from addPasskeyError/addingPasskey since registration has already
  // succeeded server-side by the time these are shown; the dialog stays open only to force
  // saving them, not to retry anything.
  const [addPasskeyBackupCodes, setAddPasskeyBackupCodes] = useState<string[] | null>(null);
  const [addSecurityKeyOpen, setAddSecurityKeyOpen] = useState(false);
  const [addSecurityKeyLabel, setAddSecurityKeyLabel] = useState("");
  const [addingSecurityKey, setAddingSecurityKey] = useState(false);
  const [addSecurityKeyError, setAddSecurityKeyError] = useState<string | null>(null);
  const [addSecurityKeyBackupCodes, setAddSecurityKeyBackupCodes] = useState<string[] | null>(null);
  const [managePasskeysOpen, setManagePasskeysOpen] = useState(false);
  const [manageSecurityKeysOpen, setManageSecurityKeysOpen] = useState(false);
  const [removeCredentialTarget, setRemoveCredentialTarget] = useState<AccountMfaMethodDto | null>(null);
  const [removeCredentialCode, setRemoveCredentialCode] = useState("");
  const [removeCredentialCodeRequired, setRemoveCredentialCodeRequired] = useState(false);
  const [removingCredential, setRemovingCredential] = useState(false);
  const [removeCredentialError, setRemoveCredentialError] = useState<string | null>(null);
  const [manageTotpOpen, setManageTotpOpen] = useState(false);
  const [removeTotpCode, setRemoveTotpCode] = useState("");
  const [removeTotpCodeRequired, setRemoveTotpCodeRequired] = useState(false);
  const [removingTotp, setRemovingTotp] = useState(false);
  const [removeTotpError, setRemoveTotpError] = useState<string | null>(null);
  const [backupCodesStatus, setBackupCodesStatus] = useState<BackupCodesStatusResponse | null>(null);
  const [manageBackupCodesOpen, setManageBackupCodesOpen] = useState(false);
  const [regenerateBackupCodesCode, setRegenerateBackupCodesCode] = useState("");
  const [regenerateBackupCodesCodeRequired, setRegenerateBackupCodesCodeRequired] = useState(false);
  const [regeneratingBackupCodes, setRegeneratingBackupCodes] = useState(false);
  const [regenerateBackupCodesError, setRegenerateBackupCodesError] = useState<string | null>(null);
  const [regeneratedBackupCodes, setRegeneratedBackupCodes] = useState<string[] | null>(null);
  const identityActions = useDropdownMenu<HTMLButtonElement>({ align: "end" });

  const loadAccount = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchAccount(signal);
      setAccount(data);
      setDisplayName(data.display_name ?? "");
      setPreferredLocale(data.preferred_locale);
      setPreferredTimeFormat(data.preferred_time_format);
      setPhoneCountryCode(data.phone_country_code ?? "");
      setPhoneNumber(data.phone_number ?? "");
      setPreferredLocaleStore(data.preferred_locale ?? undefined);
      setPreferredTimeFormatStore(data.preferred_time_format);
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

  /** GET /api/account/mfa/backup-codes doesn't come for free with loadAccount() (unlike
   * webauthn credentials, which ride along on AccountDto.mfa_methods) - fetched once on mount
   * the same way sessions are. A failure here just leaves the Backup codes row's count blank;
   * the rest of the page is fully usable without it, so it's not worth its own retry/EmptyState. */
  const loadBackupCodesStatus = useCallback(async (signal?: AbortSignal) => {
    try {
      const data = await fetchBackupCodesStatus(signal);
      setBackupCodesStatus(data);
    } catch (err) {
      if (signal?.aborted) return;
      if (redirectToLoginIfUnauthorized(err)) return;
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadAccount(controller.signal);
    void loadSessions(controller.signal);
    void loadBackupCodesStatus(controller.signal);
    return () => controller.abort();
  }, [loadAccount, loadSessions, loadBackupCodesStatus]);

  // A fetch that resolves near-instantly (localhost, a warm cache) would
  // otherwise flash the spinner on and off faster than it can register as
  // "loading", show it only once the fetch has genuinely taken a moment.
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
    preferredTimeFormat !== account.preferred_time_format ||
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

  /** Shared by the form's own submit and the step-up dialog's confirm, `proof` is only passed once the server has asked for one. */
  async function submitPasswordChange(proof?: StepUpProofBody): Promise<void> {
    const { sessions_revoked } = await patchAccountPassword({
      current_password: currentPassword,
      new_password: newPassword,
      new_password_confirm: confirmPassword,
      ...proof,
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

  /** Shared by the dialog's own confirm and the WebauthnStepUpButton below it, `proof` is only
   * passed once the server has asked for one, same two-step shape as submitPasswordChange. `target`
   * is passed explicitly rather than read from `removeCredentialTarget` state, since the caller
   * has already null-checked `.id` right before calling this. */
  async function submitRemoveCredential(target: AccountMfaMethodDto, proof?: StepUpProofBody): Promise<void> {
    await deleteWebauthnCredential(target.id!, proof);
    const removedLabel = target.label ? `"${target.label}"` : "Credential";
    setRemoveCredentialTarget(null);
    setRemoveCredentialCode("");
    setRemoveCredentialCodeRequired(false);
    addToast(`${removedLabel} removed.`, "success");
    await loadAccount();
    // Same reasoning as the TOTP-removal handler above - a step-up code here can be a backup
    // code too.
    await loadBackupCodesStatus();
  }

  /** Shared by the dialog's own confirm and the WebauthnStepUpButton below it, `proof` is only
   * passed once the server has asked for one, same two-step shape as submitPasswordChange. */
  async function submitRemoveTotp(proof?: StepUpProofBody): Promise<void> {
    await deleteAccountTotp(proof);
    setManageTotpOpen(false);
    setRemoveTotpCode("");
    setRemoveTotpCodeRequired(false);
    addToast("Authenticator app removed.", "success");
    await loadAccount();
    // A step-up code (when required) is a backup code as well as a TOTP code - refresh
    // the remaining count shown on the Backup codes row in case that's what was used.
    await loadBackupCodesStatus();
  }

  /** Shared by the dialog's own confirm and the WebauthnStepUpButton below it, `proof` is only
   * passed once the server has asked for one, same two-step shape as submitPasswordChange. */
  async function submitResetMfa(proof?: StepUpProofBody): Promise<void> {
    const { sessions_revoked } = await resetMfa({ password: resetPassword, ...proof });
    setResetPassword(""); setResetCode(""); setResetCodeRequired(false); setResetConfirmOpen(false);
    const mfaSessionsRevokedPlural = sessions_revoked === 1 ? "" : "s";
    const mfaSessionsRevokedSuffix =
      sessions_revoked > 0 ? ` ${sessions_revoked} other session${mfaSessionsRevokedPlural} ended.` : "";
    addToast(`Two-factor authentication reset.${mfaSessionsRevokedSuffix}`, "success");
    await loadAccount(); await loadSessions();
  }

  /** Shared by the confirm dialog's own submit and the step-up dialog's confirm, `proof` is only
   * passed once the server has asked for one, same two-step shape as submitPasswordChange. */
  async function submitUnlinkSso(proof?: StepUpProofBody): Promise<void> {
    await unlinkAccountExternalIdentity({
      new_password: unlinkSsoPassword,
      current_password: account?.has_local_password ? unlinkSsoCurrentPassword : undefined,
      ...proof,
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

  async function handleUnlinkSsoConfirm(): Promise<void> {
    setUnlinkSsoBusy(true);
    setUnlinkSsoError(null);
    try {
      await submitUnlinkSso();
    } catch (err) {
      if (hasApiErrorCode(err, "totp_required")) {
        setUnlinkCodeError(null);
        setUnlinkStepUpOpen(true);
      } else if (err instanceof ApiError && hasApiErrorCode(err, "invalid_request")) {
        setUnlinkSsoError(`Password must be at least ${PASSWORD_MIN_LENGTH} characters.`);
      } else if (hasApiErrorCode(err, "wrong_password") || hasApiErrorCode(err, "current_password_required")) {
        setUnlinkSsoError("Current password is incorrect.");
      } else if (hasApiErrorCode(err, "provider_managed_roles_exist")) {
        setUnlinkSsoOpen(false);
        setUnlinkSsoPassword("");
        setUnlinkSsoCurrentPassword("");
        addToast(
          "Some of your roles are managed by your identity provider. Ask an administrator to remove them before unlinking SSO.",
          "error",
        );
      } else if (hasApiErrorCode(err, "insufficient_verification")) {
        setUnlinkSsoOpen(false);
        setUnlinkSsoPassword("");
        setUnlinkSsoCurrentPassword("");
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
  }

  async function handleRemoveTotpConfirm(): Promise<void> {
    setRemovingTotp(true);
    setRemoveTotpError(null);
    try {
      await submitRemoveTotp(removeTotpCode ? { code: removeTotpCode } : undefined);
    } catch (err) {
      if (hasApiErrorCode(err, "totp_required")) {
        setRemoveTotpCodeRequired(true);
      } else {
        setRemoveTotpError(operatorApiErrorMessage(err, "Failed to remove authenticator app."));
      }
    } finally {
      setRemovingTotp(false);
    }
  }

  async function handleResetMfaConfirm(): Promise<void> {
    setResetting(true); setResetError(null);
    try {
      await submitResetMfa(resetCode ? { code: resetCode } : undefined);
    }
    catch (err) {
      if (hasApiErrorCode(err, "totp_required")) {
        // Stays open, progressive disclosure reveals the code field right here in the
        // same dialog (same pattern as the remove-credential dialog below), so there's
        // no separate step-up dialog to hand off to like password change/unlink SSO have.
        setResetCodeRequired(true);
        addToast(operatorApiErrorMessage(err, "Failed to reset 2FA."), "info");
      } else {
        setResetError(operatorApiErrorMessage(err, "Failed to reset 2FA."));
      }
    }
    finally { setResetting(false); }
  }

  async function handleAddPasskeyConfirm(): Promise<void> {
    setAddingPasskey(true);
    setAddPasskeyError(null);
    try {
      const { options } = await beginWebauthnRegistration({ attachment: "platform" });
      const response = await startRegistration({ optionsJSON: options });
      const { backupCodes } = await finishWebauthnRegistration({
        attachment: "platform",
        label: addPasskeyLabel.trim(),
        response,
      });
      addToast("Passkey added.", "success");
      await loadAccount();
      // See the matching comment on the TOTP confirm handler above - a first-ever
      // confirmed MFA method mints backup codes as a side effect.
      await loadBackupCodesStatus();
      if (backupCodes.length > 0) {
        // The only plaintext copy ever shown - keep the dialog open until the user
        // confirms they've saved them, same pattern as regenerateBackupCodes below.
        setBackupCodesSaved(false);
        setAddPasskeyBackupCodes(backupCodes);
      } else {
        setAddPasskeyOpen(false);
        setAddPasskeyLabel("");
      }
    } catch (err) {
      setAddPasskeyError(
        err instanceof ApiError
          ? operatorApiErrorMessage(err, "Could not add passkey.")
          : webauthnCeremonyErrorMessage(err),
      );
    } finally {
      setAddingPasskey(false);
    }
  }

  async function handleAddSecurityKeyConfirm(): Promise<void> {
    setAddingSecurityKey(true);
    setAddSecurityKeyError(null);
    try {
      const { options } = await beginWebauthnRegistration({ attachment: "cross-platform" });
      const response = await startRegistration({ optionsJSON: options });
      const { backupCodes } = await finishWebauthnRegistration({
        attachment: "cross-platform",
        label: addSecurityKeyLabel.trim(),
        response,
      });
      addToast("Security key added.", "success");
      await loadAccount();
      // See the matching comment on the TOTP confirm handler above - a first-ever
      // confirmed MFA method mints backup codes as a side effect.
      await loadBackupCodesStatus();
      if (backupCodes.length > 0) {
        setBackupCodesSaved(false);
        setAddSecurityKeyBackupCodes(backupCodes);
      } else {
        setAddSecurityKeyOpen(false);
        setAddSecurityKeyLabel("");
      }
    } catch (err) {
      setAddSecurityKeyError(
        err instanceof ApiError
          ? operatorApiErrorMessage(err, "Could not add security key.")
          : webauthnCeremonyErrorMessage(err),
      );
    } finally {
      setAddingSecurityKey(false);
    }
  }

  async function handleRemoveCredentialConfirm(): Promise<void> {
    // Reachable only via the trash button on a webauthn row, whose id is always set
    // (only totp/recovery rows lack one) - satisfies AccountMfaMethodDto's shared
    // optional `id` field, not a reachable runtime case.
    /* v8 ignore if */
    if (!removeCredentialTarget?.id) return;
    setRemovingCredential(true);
    setRemoveCredentialError(null);
    try {
      await submitRemoveCredential(removeCredentialTarget, removeCredentialCode ? { code: removeCredentialCode } : undefined);
    } catch (err) {
      if (hasApiErrorCode(err, "totp_required")) {
        setRemoveCredentialCodeRequired(true);
      } else {
        setRemoveCredentialError(operatorApiErrorMessage(err, "Failed to remove credential."));
      }
    } finally {
      setRemovingCredential(false);
    }
  }

  function handleRemoveCredentialCancel(): void {
    if (!removingCredential) {
      setRemoveCredentialTarget(null);
      setRemoveCredentialCode("");
      setRemoveCredentialCodeRequired(false);
      setRemoveCredentialError(null);
    }
  }

  async function handleRevokeConfirm(): Promise<void> {
    if (!revokeTarget) return;
    setRevoking(true); setRevokeError(null);
    try { await deleteAccountSession(revokeTarget.id); setRevokeTarget(null); await loadSessions(); }
    catch (err) { setRevokeError(operatorApiErrorMessage(err, "Failed to revoke session.")); }
    finally { setRevoking(false); }
  }

  function handleRevokeCancel(): void {
    if (!revoking) { setRevokeTarget(null); setRevokeError(null); }
  }

  async function handleRevokeAllConfirm(): Promise<void> {
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
  }

  function handleRevokeAllCancel(): void {
    if (!revokeAllBusy) { setRevokeAllOpen(false); setRevokeError(null); }
  }

  async function handleForgetDevicesConfirm(): Promise<void> {
    setForgetDevicesBusy(true); setForgetDevicesError(null);
    try {
      const { devices_revoked } = await forgetAllTrustedDevices();
      setForgetDevicesOpen(false);
      const plural = devices_revoked === 1 ? "" : "s";
      const pronoun = devices_revoked === 1 ? "it" : "them";
      addToast(
        devices_revoked > 0
          ? `${devices_revoked} device${plural} forgotten. You'll be asked to verify again next time you sign in on ${pronoun}.`
          : "No devices were remembered.",
        "success",
      );
      await loadAccount();
    } catch (err) {
      setForgetDevicesError(operatorApiErrorMessage(err, "Failed to forget devices."));
    } finally { setForgetDevicesBusy(false); }
  }

  function handleForgetDevicesCancel(): void {
    if (!forgetDevicesBusy) { setForgetDevicesOpen(false); setForgetDevicesError(null); }
  }

  function handleRemoveTotpCancel(): void {
    if (!removingTotp) {
      setManageTotpOpen(false);
      setRemoveTotpCode("");
      setRemoveTotpCodeRequired(false);
      setRemoveTotpError(null);
    }
  }

  function handleResetMfaCancel(): void {
    if (!resetting) {
      setResetConfirmOpen(false);
      setResetPassword("");
      setResetCode("");
      setResetCodeRequired(false);
      setResetError(null);
    }
  }

  async function handlePasswordStepUpConfirm(): Promise<void> {
    setPasswordSaving(true);
    setPasswordCodeError(null);
    try {
      await submitPasswordChange({ code: passwordCode });
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
  }

  function handlePasswordStepUpCancel(): void {
    if (!passwordSaving) {
      setPasswordStepUpOpen(false);
      setPasswordCode("");
      setPasswordCodeError(null);
    }
  }

  function handleUnlinkSsoCancel(): void {
    if (unlinkSsoBusy) return;
    setUnlinkSsoOpen(false);
    setUnlinkSsoPassword("");
    setUnlinkSsoCurrentPassword("");
    setUnlinkSsoError(null);
  }

  async function handleUnlinkStepUpConfirm(): Promise<void> {
    setUnlinkSsoBusy(true);
    setUnlinkCodeError(null);
    try {
      await submitUnlinkSso({ code: unlinkCode });
    } catch (err) {
      if (hasApiErrorCode(err, "invalid_totp")) {
        setUnlinkCodeError(operatorApiErrorMessage(err, "Failed to unlink SSO."));
      } else {
        setUnlinkSsoOpen(false);
        setUnlinkStepUpOpen(false);
        setUnlinkCode("");
        addToast(operatorApiErrorMessage(err, "Failed to unlink SSO."), "error");
      }
    } finally {
      setUnlinkSsoBusy(false);
    }
  }

  function handleUnlinkStepUpCancel(): void {
    if (!unlinkSsoBusy) {
      setUnlinkSsoOpen(false);
      setUnlinkStepUpOpen(false);
      setUnlinkCode("");
      setUnlinkCodeError(null);
    }
  }

  async function handleTotpEnrollConfirm(): Promise<void> {
    setMfaConfirming(true);
    try {
      await confirmMfaTotp({ code: totpCode });
      setEnrollData(null); setTotpCode("");
      addToast("Two-factor authentication is enabled.", "success");
      await loadAccount();
      // A first-ever confirmed MFA method mints the account's backup codes as a side
      // effect (ensureFreshEnrollmentBackupCodes) - refresh the status shown on the new
      // Backup codes row so it doesn't still read "None generated yet".
      await loadBackupCodesStatus();
    } catch (err) { addToast(operatorApiErrorMessage(err, "Invalid authenticator code."), "error"); }
    finally { setMfaConfirming(false); }
  }

  async function handleTotpEnrollCancel(): Promise<void> {
    totpInputKey.current += 1;
    setMfaEnrolling(true);
    setEnrollData(null); setTotpCode(""); setUriCopied(false); setShowUriManual(false); setQrRenderFailed(false); setBackupCodesSaved(false);
    try { await cancelMfaEnroll(); } catch { /* best-effort */ }
    finally { setMfaEnrolling(false); }
  }

  function handleAddPasskeyCancel(): void {
    if (addingPasskey) return;
    if (addPasskeyBackupCodes && !backupCodesSaved) return;
    setAddPasskeyOpen(false);
    setAddPasskeyLabel("");
    setAddPasskeyError(null);
    setAddPasskeyBackupCodes(null);
  }

  function handleAddSecurityKeyCancel(): void {
    if (addingSecurityKey) return;
    if (addSecurityKeyBackupCodes && !backupCodesSaved) return;
    setAddSecurityKeyOpen(false);
    setAddSecurityKeyLabel("");
    setAddSecurityKeyError(null);
    setAddSecurityKeyBackupCodes(null);
  }

  /** Shared by first-time enrollment (renderMfaEnrollment) and the backup-codes regenerate,
   * add-passkey, and add-security-key dialogs - all show a freshly minted plaintext batch the
   * same way, since none can ever be shown again after this render. `alreadyShown` only applies
   * to the enrollment case (an account that already had codes from an earlier method).
   *
   * `layout: "inline"` (the default, enrollment's own two-column layout) keeps Download in the
   * header next to the title, so the 2FA card height stays in lockstep with the Password card
   * (see PR #324). `layout: "stacked"` (the three dialogs above, each a narrow single-column
   * ConfirmDialog with no such height constraint) moves Download to its own centered row below
   * the codes instead, as a full button rather than a small text link, so it's not easy to miss
   * next to the tiny header text. */
  function renderBackupCodesSection(
    codes: string[],
    alreadyShown: boolean,
    layout: "inline" | "stacked" = "inline",
  ): ReactNode {
    if (codes.length > 0) {
      return (
        <div className="account-auth-backup">
          <div className="account-auth-backup__head">
            <strong>Backup codes: save all {codes.length}, shown once</strong>
            {layout === "inline" && (
              <button
                type="button"
                className="account-uri-copy-btn"
                onClick={() => downloadBackupCodes(codes)}
              >
                <i className="ti ti-download" aria-hidden="true" />{" "}
                Download
              </button>
            )}
          </div>
          <ul>{codes.map((code) => <li key={code}><code>{code}</code></li>)}</ul>
          <div className="account-checkbox-row">
            <Checkbox
              id="account-backup-codes-saved"
              label="I've saved my backup codes"
              checked={backupCodesSaved}
              onChange={(e) => setBackupCodesSaved(e.target.checked)}
            />
          </div>
          {layout === "stacked" && (
            <div className="account-auth-backup__download-row">
              <Button type="button" variant="secondary" onClick={() => downloadBackupCodes(codes)}>
                <i className="ti ti-download" aria-hidden="true" /> Download
              </Button>
            </div>
          )}
        </div>
      );
    }
    if (alreadyShown) {
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
        <EmptyState
          icon={<i className="ti ti-cloud-lock" aria-hidden="true" />}
          title="Password is managed by your identity provider"
        />
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
                  // This account's role requires MFA, collect the step-up code in a
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
            <Input
              id="account-current-password"
              name="current-password"
              label="Current password"
              type="password"
              autoComplete="current-password"
              autoCapitalize="off"
              spellCheck={false}
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
            <div className="at-password-slot">
              <Input
                id="account-new-password"
                name="new-password"
                label="New password (at least 12 characters)"
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
            <Input
              id="account-confirm-password"
              name="confirm-new-password"
              label="Confirm new password"
              type="password"
              autoComplete="new-password"
              autoCapitalize="off"
              spellCheck={false}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              error={passwordMismatch ? "Passwords do not match." : undefined}
            />
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

  /** One passkey ("platform") or security key ("cross-platform") method row, with its registered
   * same body/icon/status shape as the authenticator app row above. The credential list itself
   * lives in the "Manage" popup (renderManageWebauthnDialog) once at least one is registered,
   * rather than inline here - this row is just a summary + one action button, same as TOTP's. */
  function renderWebauthnMethodRow(attachment: WebauthnAttachment) {
    /* v8 ignore if */
    if (!account) return null;
    const isPasskey = attachment === "platform";
    const credentials = webauthnCredentials(account, attachment);
    const canAdd = account.has_local_password && account.webauthn_enabled;
    const adding = isPasskey ? addingPasskey : addingSecurityKey;
    return (
      <div className="account-mfa-method">
        <span className={`account-mfa-method__icon${credentials.length > 0 ? " account-mfa-method__icon--ok" : ""}`}>
          <i className={`ti ti-${isPasskey ? "fingerprint" : "key"}`} aria-hidden="true" />
        </span>
        <div className="account-mfa-method__body">
          <span className="account-mfa-method__name">{isPasskey ? "Passkey" : "Security key (YubiKey)"}</span>
          <span className={`account-mfa-method__status${credentials.length > 0 ? " account-mfa-method__status--ok" : ""}`}>
            {credentials.length > 0 ? `${credentials.length} registered` : "Not configured"}
          </span>
        </div>
        {(canAdd || credentials.length > 0) && (
          <div className="account-mfa-method__action">
            {credentials.length > 0 ? (
              <Button
                type="button"
                variant="secondary"
                onClick={() => (isPasskey ? setManagePasskeysOpen(true) : setManageSecurityKeysOpen(true))}
              >
                Manage
              </Button>
            ) : (
              <Button
                type="button"
                variant="primary"
                disabled={adding}
                onClick={() => {
                  if (isPasskey) {
                    setAddPasskeyLabel(""); setAddPasskeyError(null); setAddPasskeyOpen(true);
                  } else {
                    setAddSecurityKeyLabel(""); setAddSecurityKeyError(null); setAddSecurityKeyOpen(true);
                  }
                }}
              >
                Add
              </Button>
            )}
          </div>
        )}
      </div>
    );
  }

  /** Popup listing every registered passkey/security key of one type, each with a trash-icon
   * Remove (opens the existing remove-confirmation dialog below), plus "Add" to register another
   * or "Close" to dismiss - reuses ConfirmDialog's own confirm/cancel pair for those two actions
   * rather than a bespoke footer, same as every other popup in this card. */
  function renderManageWebauthnDialog(attachment: WebauthnAttachment) {
    /* v8 ignore if */
    if (!account) return null;
    const isPasskey = attachment === "platform";
    const open = isPasskey ? managePasskeysOpen : manageSecurityKeysOpen;
    const setOpen = isPasskey ? setManagePasskeysOpen : setManageSecurityKeysOpen;
    const credentials = webauthnCredentials(account, attachment);
    const canAdd = account.has_local_password && account.webauthn_enabled;
    return (
      <ConfirmDialog
        open={open}
        icon={<i className={`ti ti-${isPasskey ? "fingerprint" : "key"}`} aria-hidden="true" />}
        title={isPasskey ? "Manage passkeys" : "Manage security keys"}
        message={isPasskey ? "Your registered passkeys." : "Your registered security keys."}
        confirmLabel="Add"
        cancelLabel="Close"
        disableConfirm={!canAdd}
        onConfirm={() => {
          setOpen(false);
          if (isPasskey) {
            setAddPasskeyLabel(""); setAddPasskeyError(null); setAddPasskeyOpen(true);
          } else {
            setAddSecurityKeyLabel(""); setAddSecurityKeyError(null); setAddSecurityKeyOpen(true);
          }
        }}
        onCancel={() => setOpen(false)}
      >
        <ul className="account-mfa-credential-list">
          {credentials.map((c) => (
            <li key={c.id} className="account-mfa-credential-row">
              <span className="account-mfa-credential-row__info">
                <span className="account-mfa-credential-row__label">
                  {c.label || (isPasskey ? "Passkey" : "Security key")}
                </span>
                <span className="account-mfa-credential-row__meta">
                  {c.last_used_at ? `Last used ${formatRelativeTime(c.last_used_at)}` : "Never used"}
                </span>
              </span>
              <button
                type="button"
                className="account-mfa-credential-row__remove"
                aria-label={`Remove ${c.label || (isPasskey ? "passkey" : "security key")}`}
                onClick={() => {
                  setOpen(false);
                  setRemoveCredentialTarget(c);
                  setRemoveCredentialCode("");
                  setRemoveCredentialCodeRequired(false);
                  setRemoveCredentialError(null);
                }}
              >
                <i className="ti ti-trash" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      </ConfirmDialog>
    );
  }

  /** Backup codes' own Manage popup - status + step-up-gated "Regenerate" while no fresh batch
   * has been minted yet in this dialog session; once regeneration succeeds, the body is replaced
   * by the new plaintext codes (renderBackupCodesSection, same markup as first-time enrollment)
   * and Regenerate stays disabled so a second click can't invalidate the batch just shown. */
  /** Shared by the dialog's own confirm and the WebauthnStepUpButton below it, `proof` is only
   * passed once the server has asked for one, same two-step shape as submitPasswordChange. */
  async function submitRegenerateBackupCodes(proof?: StepUpProofBody): Promise<void> {
    const { codes } = await regenerateBackupCodes(proof);
    setRegeneratedBackupCodes(codes);
    setBackupCodesStatus({ total: codes.length, remaining: codes.length });
    // Reset for a possible next cycle: once this batch is confirmed saved, Regenerate unlocks
    // again (see disableConfirm below), and that next attempt needs its own fresh step-up proof
    // rather than resubmitting this one (a TOTP code can't be replayed within its own time step).
    setBackupCodesSaved(false);
    setRegenerateBackupCodesCode("");
    setRegenerateBackupCodesCodeRequired(false);
    addToast("Backup codes regenerated.", "success");
  }

  function renderManageBackupCodesDialog() {
    /* v8 ignore if */
    if (!account) return null;
    let statusMessage = "";
    if (backupCodesStatus?.total === 0) {
      statusMessage = `You don't have any backup codes yet. Regenerating creates a new set of ${BACKUP_RECOVERY_CODE_COUNT}.`;
    } else if (backupCodesStatus) {
      statusMessage = `${backupCodesStatus.remaining} of ${backupCodesStatus.total} backup codes remaining. Regenerating replaces them with a new set of ${BACKUP_RECOVERY_CODE_COUNT} and invalidates any you haven't used.`;
    }
    return (
      <ConfirmDialog
        open={manageBackupCodesOpen}
        icon={<i className="ti ti-list-check" aria-hidden="true" />}
        title="Manage backup codes"
        message={
          regeneratedBackupCodes
            ? "Backup codes regenerated. Save these new codes. Your previous codes no longer work."
            : statusMessage
        }
        confirmLabel="Regenerate"
        cancelLabel="Close"
        loading={regeneratingBackupCodes}
        errorMessage={regenerateBackupCodesError ?? undefined}
        disableConfirm={
          (!!regeneratedBackupCodes && !backupCodesSaved) || (regenerateBackupCodesCodeRequired && !regenerateBackupCodesCode)
        }
        onConfirm={async () => {
          setRegeneratingBackupCodes(true);
          setRegenerateBackupCodesError(null);
          // Starting a fresh regenerate cycle after already confirming the current batch is
          // saved - fall back to the code-entry flow instead of leaving the old batch on screen.
          if (regeneratedBackupCodes) setRegeneratedBackupCodes(null);
          try {
            await submitRegenerateBackupCodes(regenerateBackupCodesCode ? { code: regenerateBackupCodesCode } : undefined);
          } catch (err) {
            if (hasApiErrorCode(err, "totp_required")) {
              setRegenerateBackupCodesCodeRequired(true);
            } else {
              setRegenerateBackupCodesError(operatorApiErrorMessage(err, "Failed to regenerate backup codes."));
            }
          } finally {
            setRegeneratingBackupCodes(false);
          }
        }}
        onCancel={() => {
          if (regeneratingBackupCodes) return;
          // Same guard as handleAddPasskeyCancel: once regeneration succeeds, the previous batch
          // is already invalid and this popup is the only place the new plaintext codes are ever
          // shown - closing before the save checkbox is ticked would lose them for good.
          if (regeneratedBackupCodes && !backupCodesSaved) return;
          setManageBackupCodesOpen(false);
          setRegenerateBackupCodesCode("");
          setRegenerateBackupCodesCodeRequired(false);
          setRegenerateBackupCodesError(null);
          setRegeneratedBackupCodes(null);
        }}
      >
        {regeneratedBackupCodes
          ? renderBackupCodesSection(regeneratedBackupCodes, false, "stacked")
          : regenerateBackupCodesCodeRequired && (
            <>
              <Input
                id="account-regenerate-backup-codes-code"
                name="regenerate-backup-codes-code"
                label="Authenticator or backup code"
                type="text"
                autoComplete="one-time-code"
                autoCapitalize="off"
                spellCheck={false}
                value={regenerateBackupCodesCode}
                onChange={(e) => setRegenerateBackupCodesCode(e.target.value)}
                {...stepUpCodeFieldAttrs}
              />
              {account && hasConfirmedWebauthnMethod(account) && account.webauthn_enabled && (
                <WebauthnStepUpButton
                  busy={regeneratingBackupCodes}
                  onBusyChange={setRegeneratingBackupCodes}
                  onError={setRegenerateBackupCodesError}
                  onSubmit={submitRegenerateBackupCodes}
                />
              )}
            </>
          )}
      </ConfirmDialog>
    );
  }

  function renderMfaEnrollDialog() {
    return (
      <ConfirmDialog
        open={!!enrollData}
        icon={<i className="ti ti-shield-lock" aria-hidden="true" />}
        title="Set up two-factor authentication"
        message="Set up an authenticator app to use as your second sign-in step."
        confirmLabel="Enable"
        confirmVariant="primary"
        loading={mfaConfirming}
        disableConfirm={
          totpCode.length < 6 || ((enrollData?.backupCodes.length ?? 0) > 0 && !backupCodesSaved)
        }
        onConfirm={handleTotpEnrollConfirm}
        onCancel={handleTotpEnrollCancel}
      >
        {renderMfaEnrollment()}
      </ConfirmDialog>
    );
  }

  function renderAddPasskeyDialog() {
    return (
      <ConfirmDialog
        open={addPasskeyOpen}
        icon={<i className="ti ti-fingerprint" aria-hidden="true" />}
        title="Add passkey"
        message={
          addPasskeyBackupCodes
            ? "Passkey added. Save these backup codes: you'll need one if you ever lose access to this passkey."
            : "Give this passkey a name so you can recognize it later."
        }
        confirmLabel="Add"
        confirmVariant="primary"
        cancelLabel={addPasskeyBackupCodes ? "Close" : "Cancel"}
        loading={addingPasskey}
        errorMessage={addPasskeyError ?? undefined}
        disableConfirm={!!addPasskeyBackupCodes || !addPasskeyLabel.trim()}
        onConfirm={handleAddPasskeyConfirm}
        onCancel={handleAddPasskeyCancel}
      >
        {addPasskeyBackupCodes ? (
          renderBackupCodesSection(addPasskeyBackupCodes, false, "stacked")
        ) : (
          <Input
            id="account-add-passkey-label"
            label="Name"
            placeholder="e.g. MacBook Touch ID"
            autoComplete="off"
            maxLength={120}
            value={addPasskeyLabel}
            disabled={addingPasskey}
            onChange={(e) => setAddPasskeyLabel(e.target.value)}
          />
        )}
      </ConfirmDialog>
    );
  }

  function renderAddSecurityKeyDialog() {
    return (
      <ConfirmDialog
        open={addSecurityKeyOpen}
        icon={<i className="ti ti-key" aria-hidden="true" />}
        title="Add security key"
        message={
          addSecurityKeyBackupCodes
            ? "Security key added. Save these backup codes: you'll need one if you ever lose access to this security key."
            : "Give this security key a name so you can recognize it later."
        }
        confirmLabel="Add"
        confirmVariant="primary"
        cancelLabel={addSecurityKeyBackupCodes ? "Close" : "Cancel"}
        loading={addingSecurityKey}
        errorMessage={addSecurityKeyError ?? undefined}
        disableConfirm={!!addSecurityKeyBackupCodes || !addSecurityKeyLabel.trim()}
        onConfirm={handleAddSecurityKeyConfirm}
        onCancel={handleAddSecurityKeyCancel}
      >
        {addSecurityKeyBackupCodes ? (
          renderBackupCodesSection(addSecurityKeyBackupCodes, false, "stacked")
        ) : (
          <Input
            id="account-add-security-key-label"
            label="Name"
            placeholder="e.g. YubiKey 5C"
            autoComplete="off"
            maxLength={120}
            value={addSecurityKeyLabel}
            disabled={addingSecurityKey}
            onChange={(e) => setAddSecurityKeyLabel(e.target.value)}
          />
        )}
      </ConfirmDialog>
    );
  }

  function renderRemoveCredentialDialog() {
    return (
      <ConfirmDialog
        open={!!removeCredentialTarget}
        icon={<i className="ti ti-trash" aria-hidden="true" />}
        title={removeCredentialTarget?.attachment === "platform" ? "Remove passkey" : "Remove security key"}
        message={removeCredentialTarget ? removeCredentialMessage(removeCredentialTarget) : ""}
        confirmLabel="Remove"
        confirmVariant="danger"
        loading={removingCredential}
        errorMessage={removeCredentialError ?? undefined}
        disableConfirm={removeCredentialCodeRequired && !removeCredentialCode}
        onConfirm={handleRemoveCredentialConfirm}
        onCancel={handleRemoveCredentialCancel}
      >
        {removeCredentialTarget && account && isLastConfirmedMfaMethod(removeCredentialTarget, account) && (
          <Notice variant="warning" role="alert">
            This is your last two-factor method. You will need to set one up again the next time you sign in.
          </Notice>
        )}
        {removeCredentialCodeRequired && (
          <>
            <Input
              id="account-remove-credential-code"
              name="remove-credential-code"
              label="Authenticator or backup code"
              type="text"
              autoComplete="one-time-code"
              autoCapitalize="off"
              spellCheck={false}
              value={removeCredentialCode}
              onChange={(e) => setRemoveCredentialCode(e.target.value)}
              {...stepUpCodeFieldAttrs}
            />
            {removeCredentialTarget && account && hasConfirmedWebauthnMethod(account) && account.webauthn_enabled && (
              <WebauthnStepUpButton
                busy={removingCredential}
                onBusyChange={setRemovingCredential}
                onError={setRemoveCredentialError}
                onSubmit={(proof) => submitRemoveCredential(removeCredentialTarget, proof)}
              />
            )}
          </>
        )}
      </ConfirmDialog>
    );
  }

  function renderMfaMethodsList() {
    if (!account) return null;
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
                <Button type="button" variant="primary" disabled={mfaEnrolling} onClick={async () => {
                  setMfaEnrolling(true); setTotpCode(""); setUriCopied(false); setShowUriManual(false); setQrRenderFailed(false); setBackupCodesSaved(false);
                  try {
                    await cancelMfaEnroll().catch(() => { /* ignore, no pending enrollment */ });
                    setEnrollData(await enrollMfaTotp());
                  }
                  catch (err) { addToast(operatorApiErrorMessage(err, "Failed to start 2FA setup."), "error"); }
                  finally { setMfaEnrolling(false); }
                }}>Set up</Button>
              )}
              {totpEnrolled && (
                <Button type="button" variant="secondary" onClick={() => {
                  setManageTotpOpen(true);
                  setRemoveTotpCode("");
                  setRemoveTotpCodeRequired(false);
                  setRemoveTotpError(null);
                }}>Manage</Button>
              )}
            </div>
          )}
        </div>
        {renderWebauthnMethodRow("platform")}
        {renderWebauthnMethodRow("cross-platform")}
        {renderBackupCodesRow()}
      </div>
    );
  }

  /** Fourth row (decision 6): only shown once the account has at least one confirmed MFA method
   * of any kind, since that's the moment backup codes first get minted server-side. Unlike the
   * other three rows, its status doesn't come from account.mfa_methods - GET
   * /api/account/mfa/backup-codes is its own fetch (see loadBackupCodesStatus). */
  function renderBackupCodesRow() {
    /* v8 ignore if */
    if (!account) return null;
    if (!totpEnrolled && !hasConfirmedWebauthnMethod(account)) return null;
    const hasCodes = !!backupCodesStatus && backupCodesStatus.total > 0;
    let codesStatusLabel = "Loading…";
    if (backupCodesStatus?.total === 0) {
      codesStatusLabel = "None generated yet";
    } else if (backupCodesStatus) {
      codesStatusLabel = `${backupCodesStatus.remaining} of ${backupCodesStatus.total} remaining`;
    }
    return (
      <div className="account-mfa-method">
        <span className={`account-mfa-method__icon${hasCodes ? " account-mfa-method__icon--ok" : ""}`}>
          <i className="ti ti-list-check" aria-hidden="true" />
        </span>
        <div className="account-mfa-method__body">
          <span className="account-mfa-method__name">Backup codes</span>
          <span className={`account-mfa-method__status${hasCodes ? " account-mfa-method__status--ok" : ""}`}>
            {codesStatusLabel}
          </span>
        </div>
        {account.has_local_password && (
          <div className="account-mfa-method__action">
            <Button type="button" variant="secondary" onClick={() => {
              setManageBackupCodesOpen(true);
              setRegenerateBackupCodesCode("");
              setRegenerateBackupCodesCodeRequired(false);
              setRegenerateBackupCodesError(null);
              setRegeneratedBackupCodes(null);
              setBackupCodesSaved(false);
            }}>Manage</Button>
          </div>
        )}
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
          {renderBackupCodesSection(enrollData.backupCodes, enrollData.backupCodesAlreadyShown)}
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

  function renderTwoFactorCard() {
    if (!account) return null;
    const hasConfirmedMfa = totpEnrolled || hasConfirmedWebauthnMethod(account);
    const canResetEverything = account.has_local_password && hasConfirmedMfa;
    return (
      <Card
        title="Two-factor authentication"
        actions={
          hasConfirmedMfa ? (
            <TwoFactorMoreActions
              onReset={() => setResetConfirmOpen(true)}
              onForgetDevices={() => setForgetDevicesOpen(true)}
              showReset={canResetEverything}
              trustedDevicesCount={account.trusted_devices_count}
            />
          ) : undefined
        }
      >
          {/* Methods list, every action opens its own popup now (decision 6), so this stays
              visible at all times instead of being replaced by an inline form. */}
          {renderMfaMethodsList()}

          {!totpEnrolled && !account.has_local_password && (
            <p className="account-info-block" style={{ marginTop: "var(--space-3)" }}>
              Two-factor setup requires a local password. Sign-in-only accounts must use their identity provider or contact an administrator.
            </p>
          )}
          {totpEnrolled && !account.has_local_password && (
            <p className="account-info-block">
              Two-factor reset requires a local password. Sign-in-only accounts must contact an administrator.
            </p>
          )}
          {account.has_local_password && !account.webauthn_enabled && (
            <p className="account-info-block">
              Passkeys and security keys are turned off for this instance. Ask an administrator to enable them.
            </p>
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
        const timeFormatChanged = preferredTimeFormat !== account.preferred_time_format;
        try {
          const phoneCountryCodeChanged = phoneCountryCode !== (account.phone_country_code ?? "");
          const phoneNumberChanged = phoneNumber !== (account.phone_number ?? "");
          const result = await patchAccountProfile({
            ...(displayName !== (account.display_name ?? "") && { display_name: displayName }),
            ...(localeChanged && { preferred_locale: preferredLocale }),
            ...(timeFormatChanged && { preferred_time_format: preferredTimeFormat }),
            ...(phoneCountryCodeChanged && { phone_country_code: phoneCountryCode }),
            ...(phoneNumberChanged && { phone_number: phoneNumber || null }),
          });
          setDisplayName(result.display_name ?? "");
          setPreferredLocale(result.preferred_locale);
          setPreferredTimeFormat(result.preferred_time_format);
          setPhoneCountryCode(result.phone_country_code ?? "");
          setPhoneNumber(result.phone_number ?? "");
          setPreferredLocaleStore(result.preferred_locale ?? undefined);
          setPreferredTimeFormatStore(result.preferred_time_format);
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
                {`Dates only. Example: ${new Date("2026-06-28T12:00:00Z").toLocaleDateString(preferredLocale ?? undefined, { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" })}.`}
              </span>
          </div>
          <div className="at-field">
            <label className="at-label" htmlFor="account-time-format">
              Time format
            </label>
            <SearchableSelect
              id="account-time-format"
              label="Time format"
              placeholder="System default (browser)"
              searchPlaceholder="Search time formats…"
              emptyLabel="No time formats found"
              showLabel={false}
              value={preferredTimeFormat ?? "system-default"}
              options={TIME_FORMAT_OPTIONS.map((option) => ({ ...option }))}
              disabled={profileSaving}
              onChange={(id) => setPreferredTimeFormat(id === "12h" || id === "24h" ? id : null)}
            />
            <span className="at-hint">Choose 12-hour AM/PM or 24-hour time.</span>
          </div>
          <div className="at-field">
            <label className="at-label" htmlFor="account-language">Language</label>
            <SearchableSelect
              id="account-language"
              label="Language"
              showLabel={false}
              placeholder="English (US)"
              searchPlaceholder=""
              emptyLabel=""
              value="en-US"
              options={[{ id: "en-US", label: "English (US)" }]}
              disabled
              title="More languages are coming soon."
              onChange={() => {}}
            />
            <span className="at-hint">Coming soon - Admitto is English-only for now.</span>
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
          <div className="account-access-preferences">
            <AccountRoleDisplay account={account} />
            <AccountTypeField account={account} />
          </div>
        </div>
      </Card>

      <div className="account-security-grid">
        {renderPasswordCard()}
        {renderTwoFactorCard()}
      </div>

      {renderSessionsCard()}

      <ConfirmDialog open={!!revokeTarget} icon={<i className="ti ti-device-laptop-off" aria-hidden="true" />} title="Revoke session" message={revokeTarget ? `Revoke this session? Last active ${formatRelativeTime(revokeTarget.lastSeenAt)}.` : ""} confirmLabel="Revoke" confirmVariant="danger" loading={revoking} errorMessage={revokeError ?? undefined} onConfirm={handleRevokeConfirm} onCancel={handleRevokeCancel} />

      <ConfirmDialog open={revokeAllOpen} icon={<i className="ti ti-device-laptop-off" aria-hidden="true" />} title="Revoke all other sessions" message={`This will end ${otherSessions.length} other active session${otherSessions.length === 1 ? "" : "s"}.`} confirmLabel="Revoke" confirmVariant="danger" loading={revokeAllBusy} errorMessage={revokeError ?? undefined} onConfirm={handleRevokeAllConfirm} onCancel={handleRevokeAllCancel} />

      <ConfirmDialog open={forgetDevicesOpen} icon={<i className="ti ti-devices-off" aria-hidden="true" />} title="Forget all trusted devices" message="You'll be asked to verify with two-factor again the next time you sign in on any device you previously chose to remember." confirmLabel="Forget devices" loading={forgetDevicesBusy} errorMessage={forgetDevicesError ?? undefined} onConfirm={handleForgetDevicesConfirm} onCancel={handleForgetDevicesCancel} />

      <ConfirmDialog
        open={manageTotpOpen}
        icon={<i className="ti ti-shield-lock" aria-hidden="true" />}
        title="Manage authenticator app"
        message="Remove your authenticator app as a two-factor method. Your passkeys, security keys, and backup codes are not affected."
        confirmLabel="Remove"
        cancelLabel="Close"
        confirmVariant="danger"
        loading={removingTotp}
        errorMessage={removeTotpError ?? undefined}
        disableConfirm={removeTotpCodeRequired && !removeTotpCode}
        onConfirm={handleRemoveTotpConfirm}
        onCancel={handleRemoveTotpCancel}
      >
        {isLastConfirmedMfaMethod({ type: "totp", confirmed: true, last_used_at: null }, account) && (
          <Notice variant="warning" role="alert">
            This is your last two-factor method. You will need to set one up again the next time you sign in.
          </Notice>
        )}
        {removeTotpCodeRequired && (
          <>
            <Input
              id="account-remove-totp-code"
              name="remove-totp-code"
              label="Authenticator or backup code"
              type="text"
              autoComplete="one-time-code"
              autoCapitalize="off"
              spellCheck={false}
              value={removeTotpCode}
              onChange={(e) => setRemoveTotpCode(e.target.value)}
              {...stepUpCodeFieldAttrs}
            />
            {account && hasConfirmedWebauthnMethod(account) && account.webauthn_enabled && (
              <WebauthnStepUpButton
                busy={removingTotp}
                onBusyChange={setRemovingTotp}
                onError={setRemoveTotpError}
                onSubmit={submitRemoveTotp}
              />
            )}
          </>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        open={resetConfirmOpen}
        icon={<i className="ti ti-shield-lock" aria-hidden="true" />}
        title="Reset two-factor authentication"
        message="This removes your authenticator app, passkeys, security keys, and all backup codes, and ends your other active sessions. You will stay signed in on this device."
        confirmLabel="Reset"
        confirmVariant="danger"
        loading={resetting}
        errorMessage={resetError ?? undefined}
        disableConfirm={!resetPassword || (resetCodeRequired && !resetCode)}
        onConfirm={handleResetMfaConfirm}
        onCancel={handleResetMfaCancel}
      >
        <div className="account-reset-mfa-fields">
          <Input
            id="account-reset-password"
            name="current-password"
            label="Current password"
            type="password"
            autoComplete="current-password"
            autoCapitalize="off"
            spellCheck={false}
            value={resetPassword}
            onChange={(e) => setResetPassword(e.target.value)}
          />
          {resetCodeRequired && (
            <>
              <Input
                id="account-reset-code"
                name="reset-code"
                label="Authenticator or backup code"
                type="text"
                autoComplete="one-time-code"
                autoCapitalize="off"
                spellCheck={false}
                value={resetCode}
                onChange={(e) => setResetCode(e.target.value)}
                {...stepUpCodeFieldAttrs}
              />
              {account && hasConfirmedWebauthnMethod(account) && account.webauthn_enabled && (
                <WebauthnStepUpButton
                  busy={resetting}
                  onBusyChange={setResetting}
                  onError={setResetError}
                  onSubmit={submitResetMfa}
                />
              )}
            </>
          )}
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={passwordStepUpOpen}
        icon={<i className="ti ti-shield-lock" aria-hidden="true" />}
        title="Enter your authenticator code"
        message="This account requires a second factor to change its password. Enter a code from your authenticator app, or a backup code."
        confirmLabel="Change password"
        confirmVariant="primary"
        loading={passwordSaving}
        errorMessage={passwordCodeError ?? undefined}
        disableConfirm={!passwordCode}
        onConfirm={handlePasswordStepUpConfirm}
        onCancel={handlePasswordStepUpCancel}
      >
        <Input
          id="account-password-code"
          name="password-code"
          label="Authenticator or backup code"
          type="text"
          autoComplete="one-time-code"
          autoCapitalize="off"
          spellCheck={false}
          value={passwordCode}
          onChange={(e) => setPasswordCode(e.target.value)}
          {...stepUpCodeFieldAttrs}
        />
        {account && hasConfirmedWebauthnMethod(account) && account.webauthn_enabled && (
          <WebauthnStepUpButton
            busy={passwordSaving}
            onBusyChange={setPasswordSaving}
            onError={setPasswordCodeError}
            onSubmit={submitPasswordChange}
          />
        )}
      </ConfirmDialog>

      <ConfirmDialog
        open={unlinkSsoOpen && !unlinkStepUpOpen}
        icon={<i className="ti ti-plug-connected-x" aria-hidden="true" />}
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
        onConfirm={handleUnlinkSsoConfirm}
        onCancel={handleUnlinkSsoCancel}
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
        icon={<i className="ti ti-shield-lock" aria-hidden="true" />}
        title="Enter your authenticator code"
        message="This account requires a second factor to unlink SSO. Enter a code from your authenticator app, or a backup code."
        confirmLabel="Unlink"
        confirmVariant="danger"
        loading={unlinkSsoBusy}
        errorMessage={unlinkCodeError ?? undefined}
        disableConfirm={!unlinkCode}
        onConfirm={handleUnlinkStepUpConfirm}
        onCancel={handleUnlinkStepUpCancel}
      >
        <Input
          id="account-unlink-code"
          name="unlink-code"
          label="Authenticator or backup code"
          type="text"
          autoComplete="one-time-code"
          autoCapitalize="off"
          spellCheck={false}
          value={unlinkCode}
          onChange={(e) => setUnlinkCode(e.target.value)}
          {...stepUpCodeFieldAttrs}
        />
        {account && hasConfirmedWebauthnMethod(account) && account.webauthn_enabled && (
          <WebauthnStepUpButton
            busy={unlinkSsoBusy}
            onBusyChange={setUnlinkSsoBusy}
            onError={setUnlinkCodeError}
            onSubmit={submitUnlinkSso}
          />
        )}
      </ConfirmDialog>

      {renderMfaEnrollDialog()}
      {renderManageWebauthnDialog("platform")}
      {renderManageWebauthnDialog("cross-platform")}
      {renderManageBackupCodesDialog()}
      {renderAddPasskeyDialog()}
      {renderAddSecurityKeyDialog()}
      {renderRemoveCredentialDialog()}
    </>
  );
}
