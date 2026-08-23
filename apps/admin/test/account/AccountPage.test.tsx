// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountPage } from "../../src/account/AccountPage.js";
import type { AccountDto, AccountMfaMethodDto, SessionListDto } from "../../src/api/types.js";
import { PASSWORD_STRENGTH_STRONG } from "@admitto/auth/password-strength-fixtures";
import { BACKUP_RECOVERY_CODE_COUNT } from "@admitto/auth/constants";
import { renderWithToast } from "../test-utils.js";

vi.mock("../../src/api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/client.js")>();
  return {
    ...actual,
    fetchAccount: vi.fn(),
    fetchAccountSessions: vi.fn(),
    patchAccountProfile: vi.fn(),
    patchAccountPassword: vi.fn(),
    enrollMfaTotp: vi.fn(),
    cancelMfaEnroll: vi.fn().mockResolvedValue(undefined),
    confirmMfaTotp: vi.fn(),
    resetMfa: vi.fn(),
    deleteAccountSession: vi.fn(),
    unlinkAccountExternalIdentity: vi.fn(),
    beginWebauthnRegistration: vi.fn(),
    finishWebauthnRegistration: vi.fn(),
    deleteWebauthnCredential: vi.fn(),
    deleteAccountTotp: vi.fn(),
    fetchBackupCodesStatus: vi.fn(),
    regenerateBackupCodes: vi.fn(),
  };
});

// startRegistration() calls the real navigator.credentials.create(), which doesn't exist in
// jsdom - every test drives it through this mock instead of a real WebAuthn ceremony.
vi.mock("@simplewebauthn/browser", () => ({
  startRegistration: vi.fn(),
}));

vi.mock("../../src/account/TotpQrCode.js", () => ({
  TotpQrCode: ({
    onRenderFailed,
    onRenderSuccess,
  }: {
    onRenderFailed?: () => void;
    onRenderSuccess?: () => void;
  }) => (
    <div data-testid="totp-qr">
      <button type="button" onClick={() => onRenderFailed?.()}>
        Simulate QR fail
      </button>
      <button type="button" onClick={() => onRenderSuccess?.()}>
        Simulate QR ok
      </button>
    </div>
  ),
}));

import {
  fetchAccount,
  fetchAccountSessions,
  patchAccountProfile,
  patchAccountPassword,
  enrollMfaTotp,
  cancelMfaEnroll,
  confirmMfaTotp,
  resetMfa,
  deleteAccountSession,
  unlinkAccountExternalIdentity,
  beginWebauthnRegistration,
  finishWebauthnRegistration,
  deleteWebauthnCredential,
  deleteAccountTotp,
  fetchBackupCodesStatus,
  regenerateBackupCodes,
} from "../../src/api/client.js";
import { startRegistration } from "@simplewebauthn/browser";

const mockDeleteSession = vi.mocked(deleteAccountSession);

const mockFetchAccount = vi.mocked(fetchAccount);
const mockFetchSessions = vi.mocked(fetchAccountSessions);
const mockPatchProfile = vi.mocked(patchAccountProfile);
const mockPatchPassword = vi.mocked(patchAccountPassword);
const mockEnrollMfaTotp = vi.mocked(enrollMfaTotp);
const mockCancelMfaEnroll = vi.mocked(cancelMfaEnroll);
const mockConfirmMfaTotp = vi.mocked(confirmMfaTotp);
const mockResetMfa = vi.mocked(resetMfa);
const mockUnlinkExternalIdentity = vi.mocked(unlinkAccountExternalIdentity);
const mockBeginWebauthnRegistration = vi.mocked(beginWebauthnRegistration);
const mockFinishWebauthnRegistration = vi.mocked(finishWebauthnRegistration);
const mockDeleteWebauthnCredential = vi.mocked(deleteWebauthnCredential);
const mockDeleteAccountTotp = vi.mocked(deleteAccountTotp);
const mockFetchBackupCodesStatus = vi.mocked(fetchBackupCodesStatus);
const mockRegenerateBackupCodes = vi.mocked(regenerateBackupCodes);
const mockStartRegistration = vi.mocked(startRegistration);

const REVOKE_SESSION_BUTTON = /Revoke session for admin@example.com/;

const baseAccount: AccountDto = {
  id: "usr-1",
  email: "admin@example.com",
  display_name: "Admin",
  preferred_locale: "en-GB",
  preferred_time_format: null,
  is_active: true,
  must_change_password: false,
  has_local_password: true,
  phone_country_code: null,
  phone_number: null,
  roles: [],
  mfa_methods: [],
  external_identities: [],
  available_identity_providers: [],
  webauthn_enabled: true,
};

const totpEnrolledAccount: AccountDto = {
  ...baseAccount,
  mfa_methods: [{ type: "totp", confirmed: true, last_used_at: null }],
};

/** A registered passkey ("platform") or security key ("cross-platform") row — mirrors what
 * GET /api/account returns for a confirmed webauthn credential. */
function makeWebauthnMethod(overrides: Partial<AccountMfaMethodDto> = {}): AccountMfaMethodDto {
  return {
    type: "webauthn",
    confirmed: true,
    last_used_at: null,
    id: "cred-1",
    label: "MacBook Touch ID",
    attachment: "platform",
    ...overrides,
  };
}

/** Plausible fake shapes for the two @simplewebauthn/browser payloads that cross the wire during
 * registration - opaque to AccountPage.tsx (it forwards options -> ceremony -> response as-is),
 * so only their presence/round-tripping matters here, not exact spec conformance. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const FAKE_REGISTRATION_OPTIONS: any = {
  rp: { id: "localhost", name: "Admitto" },
  user: { id: "dXNyLTE", name: "admin@example.com", displayName: "Admin" },
  challenge: "Y2hhbGxlbmdl",
  pubKeyCredParams: [{ type: "public-key", alg: -7 }],
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const FAKE_REGISTRATION_RESPONSE: any = {
  id: "cred-1",
  rawId: "cred-1",
  type: "public-key",
  clientExtensionResults: {},
  response: {
    clientDataJSON: "eyJ0eXBlIjoid2ViYXV0aG4uY3JlYXRlIn0",
    attestationObject: "o2NmbXRk",
  },
};

const newPasswordLabel = /^New password/;

function fillPasswordForm() {
  fireEvent.change(screen.getByLabelText("Current password"), {
    target: { value: "old-password-1" },
  });
  fireEvent.change(screen.getByLabelText(newPasswordLabel), {
    target: { value: "new-password-12" },
  });
  fireEvent.change(screen.getByLabelText("Confirm new password"), {
    target: { value: "new-password-12" },
  });
}

function makeAccountSession(overrides: Partial<SessionListDto> = {}): SessionListDto {
  return {
    id: "sess-1",
    userId: "usr-1",
    userEmail: "admin@example.com",
    userDisplayName: "Admin",
    role: "superadmin",
    deviceLabel: "This device",
    ip: null,
    country: { kind: "unknown" },
    userAgent: null,
    loginAt: "2026-01-01T00:00:00.000Z",
    lastSeenAt: "2026-01-01T01:00:00.000Z",
    expiresAt: "2026-01-02T00:00:00.000Z",
    authMethod: "local",
    stage: "active",
    timezone: null,
    isCurrent: true,
    ...overrides,
  };
}

function makeCurrentAndOtherSessions(otherOverrides: Partial<SessionListDto> = {}) {
  const currentSession = makeAccountSession();
  const otherSession = makeAccountSession({
    id: "sess-2",
    isCurrent: false,
    deviceLabel: "Other",
    ...otherOverrides,
  });
  return { currentSession, otherSession };
}

function mockLoadedAccount(account: AccountDto = baseAccount) {
  mockFetchAccount.mockResolvedValue(account);
  mockFetchSessions.mockResolvedValue({ sessions: [] });
}

/** The TOTP row's own action button is just "Manage" (matching passkey/security-key rows), so
 * tests need to scope by the row's container - unscoped, it's ambiguous with the passkey,
 * security-key, and backup-codes rows' own "Manage" buttons. */
function totpRow(): HTMLElement {
  return screen.getByText("Authenticator app (TOTP)").closest(".account-mfa-method") as HTMLElement;
}

/** Same scoping need as totpRow() - the Backup codes row's own "Manage" button. */
function backupCodesRow(): HTMLElement {
  return screen.getByText("Backup codes").closest(".account-mfa-method") as HTMLElement;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("AccountPage delayed loading", () => {
  it("shows the account spinner once the fetch has genuinely taken a moment", () => {
    mockFetchAccount.mockImplementation(() => new Promise(() => {}));
    mockFetchSessions.mockImplementation(() => new Promise(() => {}));
    vi.useFakeTimers();
    renderWithToast(<AccountPage />);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.getByLabelText("Loading account")).toBeTruthy();
  });

  it("shows the sessions spinner once the fetch has genuinely taken a moment", async () => {
    let resolveAccountFetch: (value: AccountDto) => void = () => {};
    mockFetchAccount.mockImplementation(
      () => new Promise((resolve) => { resolveAccountFetch = resolve; }),
    );
    mockFetchSessions.mockImplementation(() => new Promise(() => {}));
    vi.useFakeTimers();
    renderWithToast(<AccountPage />);
    await act(async () => {
      resolveAccountFetch(baseAccount);
    });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.getByLabelText("Loading sessions")).toBeTruthy();
  });

  it("measures the sessions no-flash window from when the sessions card becomes visible, not from mount (Sonar/PO review)", async () => {
    let resolveAccountFetch: (value: AccountDto) => void = () => {};
    mockFetchAccount.mockImplementation(
      () => new Promise((resolve) => { resolveAccountFetch = resolve; }),
    );
    mockFetchSessions.mockImplementation(() => new Promise(() => {}));
    vi.useFakeTimers();
    renderWithToast(<AccountPage />);

    // Let 150ms elapse on the account fetch's own clock before it resolves — almost the
    // whole no-flash window — to prove the sessions spinner's window doesn't inherit this
    // elapsed time from a timer that started ticking at mount.
    act(() => {
      vi.advanceTimersByTime(150);
    });
    await act(async () => {
      resolveAccountFetch(baseAccount);
    });

    // Only 50ms further (200ms total since mount) — not nearly enough for the sessions
    // card's own fresh 200ms window, which only starts once it becomes visible here.
    act(() => {
      vi.advanceTimersByTime(50);
    });
    expect(screen.queryByLabelText("Loading sessions")).toBeNull();

    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(screen.getByLabelText("Loading sessions")).toBeTruthy();
  });
});

describe("AccountPage toasts", () => {
  /** Opens the "Two-factor authentication" card's header kebab menu and clicks its
   * "Reset everything" item (account-wide, not part of any one method's Manage popup - see
   * AccountPage.tsx's TwoFactorMoreActions/renderTwoFactorCard), landing on the "Reset
   * two-factor authentication" confirmation dialog. */
  async function openResetMfaDialog(): Promise<HTMLElement> {
    fireEvent.click(screen.getByRole("button", { name: "Two-factor authentication options" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /^Reset everything/ }));
    return screen.findByRole("dialog", { name: "Reset two-factor authentication" });
  }

  it("toasts profile save success", async () => {
    mockLoadedAccount();
    mockPatchProfile.mockResolvedValueOnce({ ...baseAccount, display_name: "New Name" });

    renderWithToast(<AccountPage />);
    await waitFor(() => {
      expect(screen.getByLabelText("Display name")).toBeTruthy();
    });

    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "New Name" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(/^Profile saved\./);
    });
    expect(screen.queryByText("Profile saved.", { selector: ".text-success" })).toBeNull();
  });

  it("keeps locale-change reload reminder visible until dismissed", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockLoadedAccount();
    mockPatchProfile.mockResolvedValueOnce({ ...baseAccount, preferred_locale: "pl-PL" });

    renderWithToast(<AccountPage />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /^Regional format,/ })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: /^Regional format,/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Polski:/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(/Reload this page/);
    });

    vi.advanceTimersByTime(10_000);
    expect(screen.getByTestId("at-toast").textContent).toMatch(/Reload this page/);
    vi.useRealTimers();
  });

  it("selecting System default clears the locale to null and updates the example date", async () => {
    mockLoadedAccount();
    renderWithToast(<AccountPage />);
    await screen.findByRole("button", { name: /^Regional format,/ });
    expect(screen.getByRole("button", { name: /^Regional format, English \(UK\)/ })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /^Regional format,/ }));
    fireEvent.click(screen.getByRole("button", { name: /^System default \(browser\):/ }));

    expect(screen.getByRole("button", { name: /^Regional format, System default \(browser\)/ })).toBeTruthy();
  });

  it("saves a time format independently from the regional date format", async () => {
    mockLoadedAccount();
    mockPatchProfile.mockResolvedValueOnce({ ...baseAccount, preferred_time_format: "12h" });

    renderWithToast(<AccountPage />);
    await screen.findByRole("button", { name: /^Time format,/ });

    fireEvent.click(screen.getByRole("button", { name: /^Time format,/ }));
    fireEvent.click(screen.getByRole("button", { name: "12-hour time (1:30 PM)" }));
    expect(screen.getByRole("button", { name: /^Time format, 12-hour time/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(mockPatchProfile).toHaveBeenCalledWith({ preferred_time_format: "12h" });
    });
    expect(screen.getByRole("button", { name: /^Regional format, English \(UK\)/ })).toBeTruthy();
  });

  it("clears the time-format preference without changing the regional date format", async () => {
    mockFetchAccount.mockResolvedValueOnce({ ...baseAccount, preferred_time_format: "24h" });
    mockPatchProfile.mockResolvedValueOnce({ ...baseAccount, preferred_time_format: null });

    renderWithToast(<AccountPage />);
    await screen.findByRole("button", { name: /^Time format, 24-hour time/ });
    fireEvent.click(screen.getByRole("button", { name: /^Time format, 24-hour time/ }));
    fireEvent.click(screen.getByRole("button", { name: "System default (browser)" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(mockPatchProfile).toHaveBeenCalledWith({ preferred_time_format: null });
    });
    expect(screen.getByRole("button", { name: /^Regional format, English \(UK\)/ })).toBeTruthy();
  });

  it("toasts profile save errors", async () => {
    mockLoadedAccount();
    const { ApiError } = await import("../../src/api/client.js");
    mockPatchProfile.mockRejectedValueOnce(new ApiError(400, "Invalid display name"));

    renderWithToast(<AccountPage />);
    await waitFor(() => {
      expect(screen.getByLabelText("Display name")).toBeTruthy();
    });

    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "New Name" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(/Invalid display name/);
    });
  });

  it("keeps password mismatch inline without a toast", async () => {
    mockLoadedAccount();

    renderWithToast(<AccountPage />);
    await waitFor(() => {
      expect(screen.getByLabelText(newPasswordLabel)).toBeTruthy();
    });

    fireEvent.change(screen.getByLabelText(newPasswordLabel), {
      target: { value: "long-enough-pass" },
    });
    fireEvent.change(screen.getByLabelText("Confirm new password"), {
      target: { value: "different-pass" },
    });

    expect(screen.getByText("Passwords do not match.")).toBeTruthy();
    expect(screen.queryByTestId("at-toast")).toBeNull();
  });

  it("shows password strength feedback while typing a new password", async () => {
    mockLoadedAccount();

    renderWithToast(<AccountPage />);
    await waitFor(() => {
      expect(screen.getByLabelText(newPasswordLabel)).toBeTruthy();
    });

    fireEvent.change(screen.getByLabelText(newPasswordLabel), {
      target: { value: "short" },
    });
    expect(screen.getByText("Too short")).toBeTruthy();

    fireEvent.change(screen.getByLabelText(newPasswordLabel), {
      target: { value: PASSWORD_STRENGTH_STRONG },
    });
    expect(screen.getByText("Strong")).toBeTruthy();
  });

  it("exposes password-manager hints on the change-password form", async () => {
    mockLoadedAccount();

    renderWithToast(<AccountPage />);
    await waitFor(() => {
      expect(screen.getByLabelText("Current password")).toBeTruthy();
    });

    const form = screen.getByRole("form", { name: "Change password" });
    expect(form).toBeTruthy();

    expect(screen.getByLabelText("Current password").getAttribute("name")).toBe("current-password");
    expect(screen.getByLabelText("Current password").getAttribute("autocomplete")).toBe("current-password");

    const newPassword = screen.getByLabelText(newPasswordLabel);
    expect(newPassword.getAttribute("name")).toBe("new-password");
    expect(newPassword.getAttribute("autocomplete")).toBe("new-password");
    expect(newPassword.getAttribute("passwordrules")).toBe("minlength: 12;");

    // Matches the SSR /setup and /change-password pages — "new-password" lets
    // password managers fill/save the confirm field consistently.
    expect(screen.getByLabelText("Confirm new password").getAttribute("autocomplete")).toBe(
      "new-password",
    );

    const username = document.querySelector<HTMLInputElement>('input[name="username"]');
    expect(username?.value).toBe("admin@example.com");
    expect(username?.getAttribute("autocomplete")).toBe("username");
  });

  it("toasts password change success", async () => {
    mockLoadedAccount();
    mockPatchPassword.mockResolvedValueOnce({ sessions_revoked: 2 });

    renderWithToast(<AccountPage />);
    await waitFor(() => {
      expect(screen.getByLabelText("Current password")).toBeTruthy();
    });

    fillPasswordForm();
    fireEvent.click(screen.getByRole("button", { name: "Change password" }));

    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(
        /Password changed\. 2 other sessions revoked\./,
      );
    });
  });

  it("omits the revoked-session suffix when changing a password revokes no other sessions", async () => {
    mockLoadedAccount();
    mockPatchPassword.mockResolvedValueOnce({ sessions_revoked: 0 });

    renderWithToast(<AccountPage />);
    await waitFor(() => {
      expect(screen.getByLabelText("Current password")).toBeTruthy();
    });

    fillPasswordForm();
    fireEvent.click(screen.getByRole("button", { name: "Change password" }));

    await waitFor(() => {
      expect(screen.getByText("Password changed.")).toBeTruthy();
    });
  });

  it("toasts password change errors", async () => {
    mockLoadedAccount();
    const { ApiError } = await import("../../src/api/client.js");
    mockPatchPassword.mockRejectedValueOnce(new ApiError(401, "wrong_password", "wrong_password"));

    renderWithToast(<AccountPage />);
    await waitFor(() => {
      expect(screen.getByLabelText("Current password")).toBeTruthy();
    });

    fillPasswordForm();
    fireEvent.click(screen.getByRole("button", { name: "Change password" }));

    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(/Current password is incorrect/);
    });
  });

  it("opens a step-up dialog on totp_required, without touching the password form's own layout", async () => {
    mockFetchAccount.mockResolvedValue(totpEnrolledAccount);
    mockFetchSessions.mockResolvedValue({ sessions: [] });
    const { ApiError } = await import("../../src/api/client.js");
    mockPatchPassword.mockRejectedValueOnce(new ApiError(400, "totp_required", "totp_required"));

    renderWithToast(<AccountPage />);
    await waitFor(() => {
      expect(screen.getByLabelText("Current password")).toBeTruthy();
    });

    fillPasswordForm();
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Change password" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText("Authenticator or backup code")).toBeTruthy();
    // The field appears in the dialog, not in the (unchanged) form behind it.
    expect(screen.getByLabelText("Current password")).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Change password" }).hasAttribute("disabled")).toBe(true);
  });

  it("shows an inline error in the dialog for a wrong step-up code and keeps it open", async () => {
    mockFetchAccount.mockResolvedValue(totpEnrolledAccount);
    mockFetchSessions.mockResolvedValue({ sessions: [] });
    const { ApiError } = await import("../../src/api/client.js");
    mockPatchPassword
      .mockRejectedValueOnce(new ApiError(400, "totp_required", "totp_required"))
      .mockRejectedValueOnce(new ApiError(401, "invalid_totp", "invalid_totp"));

    renderWithToast(<AccountPage />);
    await waitFor(() => {
      expect(screen.getByLabelText("Current password")).toBeTruthy();
    });

    fillPasswordForm();
    fireEvent.click(screen.getByRole("button", { name: "Change password" }));
    const dialog = await screen.findByRole("dialog");

    fireEvent.change(within(dialog).getByLabelText("Authenticator or backup code"), {
      target: { value: "000000" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Change password" }));

    await waitFor(() => {
      expect(within(dialog).getByText("Invalid authenticator or backup code.")).toBeTruthy();
    });
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect((screen.getByLabelText("Current password") as HTMLInputElement).value).toBe("old-password-1");
  });

  it("submits the code entered in the dialog and completes the password change", async () => {
    mockFetchAccount.mockResolvedValue(totpEnrolledAccount);
    mockFetchSessions.mockResolvedValue({ sessions: [] });
    const { ApiError } = await import("../../src/api/client.js");
    mockPatchPassword
      .mockRejectedValueOnce(new ApiError(400, "totp_required", "totp_required"))
      .mockResolvedValueOnce({ sessions_revoked: 1 });

    renderWithToast(<AccountPage />);
    await waitFor(() => {
      expect(screen.getByLabelText("Current password")).toBeTruthy();
    });

    fillPasswordForm();
    fireEvent.click(screen.getByRole("button", { name: "Change password" }));
    const dialog = await screen.findByRole("dialog");

    fireEvent.change(within(dialog).getByLabelText("Authenticator or backup code"), {
      target: { value: "123456" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Change password" }));

    await waitFor(() => {
      expect(screen.getByText(/Password changed\. 1 other session revoked\./)).toBeTruthy();
    });
    expect(mockPatchPassword).toHaveBeenLastCalledWith({
      current_password: "old-password-1",
      new_password: "new-password-12",
      new_password_confirm: "new-password-12",
      code: "123456",
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes the step-up dialog, toasts, and clears the entered code on a non-invalid_totp failure", async () => {
    mockFetchAccount.mockResolvedValue(totpEnrolledAccount);
    mockFetchSessions.mockResolvedValue({ sessions: [] });
    const { ApiError } = await import("../../src/api/client.js");
    mockPatchPassword
      .mockRejectedValueOnce(new ApiError(400, "totp_required", "totp_required"))
      .mockRejectedValueOnce(new ApiError(429, "too many requests"))
      .mockRejectedValueOnce(new ApiError(400, "totp_required", "totp_required"));

    renderWithToast(<AccountPage />);
    await waitFor(() => {
      expect(screen.getByLabelText("Current password")).toBeTruthy();
    });

    fillPasswordForm();
    fireEvent.click(screen.getByRole("button", { name: "Change password" }));
    let dialog = await screen.findByRole("dialog");

    fireEvent.change(within(dialog).getByLabelText("Authenticator or backup code"), {
      target: { value: "123456" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Change password" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(screen.getByTestId("at-toast").textContent).toMatch(/too many requests/i);
    });

    // Reopening the dialog must not resurface the previously-rejected/rate-limited code.
    fireEvent.click(screen.getByRole("button", { name: "Change password" }));
    dialog = await screen.findByRole("dialog");
    expect((within(dialog).getByLabelText("Authenticator or backup code") as HTMLInputElement).value).toBe("");
  });

  it("cancels the step-up dialog without submitting and clears the entered code", async () => {
    mockFetchAccount.mockResolvedValue(totpEnrolledAccount);
    mockFetchSessions.mockResolvedValue({ sessions: [] });
    const { ApiError } = await import("../../src/api/client.js");
    mockPatchPassword
      .mockRejectedValueOnce(new ApiError(400, "totp_required", "totp_required"))
      .mockRejectedValueOnce(new ApiError(400, "totp_required", "totp_required"));

    renderWithToast(<AccountPage />);
    await waitFor(() => {
      expect(screen.getByLabelText("Current password")).toBeTruthy();
    });

    fillPasswordForm();
    fireEvent.click(screen.getByRole("button", { name: "Change password" }));
    let dialog = await screen.findByRole("dialog");

    fireEvent.change(within(dialog).getByLabelText("Authenticator or backup code"), {
      target: { value: "123456" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(mockPatchPassword).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Change password" }));
    dialog = await screen.findByRole("dialog");
    expect((within(dialog).getByLabelText("Authenticator or backup code") as HTMLInputElement).value).toBe("");
  });

  it("toasts MFA enrollment errors", async () => {
    mockLoadedAccount();
    const { ApiError } = await import("../../src/api/client.js");
    mockEnrollMfaTotp.mockRejectedValueOnce(new ApiError(409, "already_enrolled", "already_enrolled"));

    renderWithToast(<AccountPage />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Set up" })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Set up" }));

    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(/already enabled/i);
    });
  });

  it("requires backup-code acknowledgement before confirming fresh enrollment", async () => {
    mockLoadedAccount();
    mockEnrollMfaTotp.mockResolvedValueOnce({
      otpauthUri: "otpauth://totp/Admitto?secret=ABC",
      backupCodes: ["1111-2222", "3333-4444"],
      backupCodesAlreadyShown: false,
    });

    renderWithToast(<AccountPage />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Set up" })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Set up" }));

    await waitFor(() => {
      expect(screen.getByLabelText("I've saved my backup codes")).toBeTruthy();
    });

    fireEvent.change(screen.getByLabelText("Authenticator code"), { target: { value: "123456" } });
    expect(screen.getByRole("button", { name: "Enable" }).hasAttribute("disabled")).toBe(true);

    fireEvent.click(screen.getByLabelText("I've saved my backup codes"));
    expect(screen.getByRole("button", { name: "Enable" }).hasAttribute("disabled")).toBe(false);
  });

  it("keeps enrollment usable when no backup-code section needs to be shown", async () => {
    mockLoadedAccount();
    mockEnrollMfaTotp.mockResolvedValueOnce({
      otpauthUri: "otpauth://totp/Admitto?secret=NONE",
      backupCodes: [],
      backupCodesAlreadyShown: false,
    });

    renderWithToast(<AccountPage />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Set up" })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Set up" }));

    await waitFor(() => {
      expect(screen.getByLabelText("Authenticator code")).toBeTruthy();
    });
    expect(screen.queryByText("Backup codes: save all 10, shown once")).toBeNull();
    expect(screen.queryByLabelText("I've saved my backup codes")).toBeNull();
  });

  it("downloads backup codes as .txt in the enrollment page format", async () => {
    mockLoadedAccount();
    mockEnrollMfaTotp.mockResolvedValueOnce({
      otpauthUri: "otpauth://totp/Admitto?secret=ABC",
      backupCodes: ["1111-2222", "3333-4444"],
      backupCodesAlreadyShown: false,
    });

    const createObjectURL = vi.fn((_blob: Blob | MediaSource) => "blob:mock-codes");
    const revokeObjectURL = vi.fn();
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
    const anchorClicks: string[] = [];
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement) {
        anchorClicks.push(this.download);
      });

    try {
      renderWithToast(<AccountPage />);
      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Set up" })).toBeTruthy();
      });
      fireEvent.click(screen.getByRole("button", { name: "Set up" }));

      fireEvent.click(await screen.findByRole("button", { name: "Download" }));

      expect(createObjectURL).toHaveBeenCalledOnce();
      const blob = createObjectURL.mock.calls[0]![0] as Blob;
      const text = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error);
        reader.readAsText(blob);
      });
      expect(text).toBe("1111-2222\n3333-4444\n");
      expect(blob.type).toContain("text/plain");
      expect(anchorClicks).toEqual(["admitto-backup-codes.txt"]);
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock-codes");
    } finally {
      clickSpy.mockRestore();
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
    }
  });

  it("toasts MFA confirm success", async () => {
    mockFetchAccount
      .mockResolvedValueOnce(baseAccount)
      .mockResolvedValueOnce(totpEnrolledAccount);
    mockFetchSessions.mockResolvedValue({ sessions: [] });
    mockEnrollMfaTotp.mockResolvedValueOnce({
      otpauthUri: "otpauth://totp/Admitto?secret=ABC",
      backupCodes: [],
      backupCodesAlreadyShown: true,
    });
    mockConfirmMfaTotp.mockResolvedValueOnce(undefined);

    renderWithToast(<AccountPage />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Set up" })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Set up" }));
    await waitFor(() => {
      expect(screen.getByLabelText("Authenticator code")).toBeTruthy();
    });

    fireEvent.change(screen.getByLabelText("Authenticator code"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Enable" }));

    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(
        /Two-factor authentication is enabled\./,
      );
    });
  });

  it("toasts MFA confirm errors", async () => {
    mockLoadedAccount();
    mockEnrollMfaTotp.mockResolvedValueOnce({
      otpauthUri: "otpauth://totp/Admitto?secret=ABC",
      backupCodes: [],
      backupCodesAlreadyShown: true,
    });
    const { ApiError } = await import("../../src/api/client.js");
    mockConfirmMfaTotp.mockRejectedValueOnce(new ApiError(400, "invalid_code", "invalid_code"));

    renderWithToast(<AccountPage />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Set up" })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Set up" }));
    await waitFor(() => {
      expect(screen.getByLabelText("Authenticator code")).toBeTruthy();
    });

    fireEvent.change(screen.getByLabelText("Authenticator code"), { target: { value: "000000" } });
    fireEvent.click(screen.getByRole("button", { name: "Enable" }));

    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(/Invalid authenticator code/);
    });
  });

  it("toasts MFA reset success", async () => {
    mockFetchAccount
      .mockResolvedValueOnce(totpEnrolledAccount)
      .mockResolvedValueOnce(baseAccount);
    mockFetchSessions.mockResolvedValue({ sessions: [] });
    mockResetMfa.mockResolvedValueOnce({ sessions_revoked: 1 });

    renderWithToast(<AccountPage />);
    await waitFor(() => {
      expect(within(totpRow()).getByRole("button", { name: "Manage" })).toBeTruthy();
    });

    const dialog = await openResetMfaDialog();
    expect(dialog.textContent).toMatch(/stay signed in on this device/i);
    fireEvent.change(within(dialog).getByLabelText("Current password", { selector: "#account-reset-password" }), {
      target: { value: "current-password" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Reset" }));

    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(
        /Two-factor authentication reset\. 1 other session ended\./,
      );
    });
  });

  it("pluralizes the revoked-session count in the MFA reset toast", async () => {
    mockFetchAccount
      .mockResolvedValueOnce(totpEnrolledAccount)
      .mockResolvedValueOnce(baseAccount);
    mockFetchSessions.mockResolvedValue({ sessions: [] });
    mockResetMfa.mockResolvedValueOnce({ sessions_revoked: 2 });

    renderWithToast(<AccountPage />);
    await waitFor(() => {
      expect(within(totpRow()).getByRole("button", { name: "Manage" })).toBeTruthy();
    });

    const dialog = await openResetMfaDialog();
    fireEvent.change(within(dialog).getByLabelText("Current password", { selector: "#account-reset-password" }), {
      target: { value: "current-password" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Reset" }));

    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(
        /Two-factor authentication reset\. 2 other sessions ended\./,
      );
    });
  });

  it("cancels pending MFA enrollment and calls cancel API", async () => {
    mockLoadedAccount();
    mockEnrollMfaTotp.mockResolvedValueOnce({
      otpauthUri: "otpauth://totp/Admitto?secret=ABC",
      backupCodes: ["1111-2222"],
      backupCodesAlreadyShown: false,
    });

    renderWithToast(<AccountPage />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Set up" })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Set up" }));
    await waitFor(() => {
      expect(screen.getByText("Backup codes: save all 1, shown once")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => {
      expect(mockCancelMfaEnroll).toHaveBeenCalled();
      expect(screen.queryByLabelText("Authenticator code")).toBeNull();
    });
  });

  it("cancels the reset dialog without calling the reset API and clears the entered password", async () => {
    mockFetchAccount.mockResolvedValue(totpEnrolledAccount);
    mockFetchSessions.mockResolvedValue({ sessions: [] });

    renderWithToast(<AccountPage />);
    await waitFor(() => {
      expect(within(totpRow()).getByRole("button", { name: "Manage" })).toBeTruthy();
    });

    let dialog = await openResetMfaDialog();
    fireEvent.change(within(dialog).getByLabelText("Current password", { selector: "#account-reset-password" }), {
      target: { value: "current-password" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(mockResetMfa).not.toHaveBeenCalled();

    dialog = await openResetMfaDialog();
    expect(
      (within(dialog).getByLabelText("Current password", { selector: "#account-reset-password" }) as HTMLInputElement)
        .value,
    ).toBe("");
  });

  it("revokes all other sessions successfully", async () => {
    const { currentSession, otherSession } = makeCurrentAndOtherSessions();
    mockLoadedAccount();
    mockFetchSessions.mockResolvedValue({ sessions: [currentSession, otherSession] });
    mockDeleteSession.mockResolvedValue(undefined);

    renderWithToast(<AccountPage />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Revoke all other sessions" })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Revoke all other sessions" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Revoke" }));

    await waitFor(() => {
      expect(mockDeleteSession).toHaveBeenCalledWith("sess-2");
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });

  it("shows a recoverable session-load error and retries the request", async () => {
    mockFetchAccount.mockResolvedValue(baseAccount);
    mockFetchSessions
      .mockRejectedValueOnce(new Error("internal session transport detail"))
      .mockResolvedValueOnce({ sessions: [] });

    renderWithToast(<AccountPage />);
    expect(await screen.findByText("Failed to load sessions.")).toBeTruthy();
    expect(screen.queryByText("internal session transport detail")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => {
      expect(mockFetchSessions).toHaveBeenCalledTimes(2);
      expect(screen.getByText("No active sessions.")).toBeTruthy();
    });
  });

  it("cancels individual and bulk session revocation dialogs without making changes", async () => {
    const { currentSession, otherSession } = makeCurrentAndOtherSessions();
    mockFetchAccount.mockResolvedValue(baseAccount);
    mockFetchSessions.mockResolvedValue({ sessions: [currentSession, otherSession] });

    renderWithToast(<AccountPage />);
    await screen.findByRole("button", { name: "Revoke all other sessions" });

    const otherSessionRevoke = screen
      .getAllByRole("button", { name: REVOKE_SESSION_BUTTON })
      .find((btn) => !(btn as HTMLButtonElement).disabled);
    expect(otherSessionRevoke).toBeTruthy();
    fireEvent.click(otherSessionRevoke!);
    let dialog = await screen.findByRole("dialog", { name: "Revoke session" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Revoke all other sessions" }));
    dialog = await screen.findByRole("dialog", { name: "Revoke all other sessions" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mockDeleteSession).not.toHaveBeenCalled();
  });

  it("labels sessions from browser and operating-system user agents", async () => {
    mockLoadedAccount();
    mockFetchSessions.mockResolvedValue({
      sessions: [
        makeAccountSession({
          id: "edge-windows",
          deviceLabel: null,
          userAgent: "Mozilla/5.0 (Windows NT 10.0) Edg/123.0",
        }),
        makeAccountSession({
          id: "chrome-macos",
          isCurrent: false,
          deviceLabel: null,
          userAgent: "Mozilla/5.0 (Mac OS X 10_15_7) Chrome/123.0",
        }),
        makeAccountSession({
          id: "firefox-linux",
          isCurrent: false,
          deviceLabel: null,
          userAgent: "Mozilla/5.0 (X11; Linux x86_64) Firefox/123.0",
        }),
        makeAccountSession({
          id: "safari-ios",
          isCurrent: false,
          deviceLabel: null,
          userAgent: "Mobile iPhone Safari/17.0",
        }),
        makeAccountSession({
          id: "unknown",
          isCurrent: false,
          deviceLabel: null,
          userAgent: "curl/8.7.1",
        }),
      ],
    });

    renderWithToast(<AccountPage />);

    await waitFor(() => {
      expect(screen.getByText("Edge / Windows")).toBeTruthy();
    });
    expect(screen.getByText("Chrome / macOS")).toBeTruthy();
    expect(screen.getByText("Firefox / Linux")).toBeTruthy();
    expect(screen.getByText("Safari / iOS")).toBeTruthy();
    expect(screen.getByText("curl/8.7.1")).toBeTruthy();
  });

  it("shows the signer's stored timezone under Logged in when Session.timezone is set", async () => {
    mockLoadedAccount();
    mockFetchSessions.mockResolvedValue({
      sessions: [
        makeAccountSession({
          timezone: "Europe/Warsaw",
          loginAt: "2026-01-01T12:00:00.000Z",
        }),
      ],
    });

    renderWithToast(<AccountPage />);

    await waitFor(() => {
      expect(screen.getByText(/Europe\/Warsaw/)).toBeTruthy();
    });
    expect(screen.getByTitle("Signer's local time")).toBeTruthy();
  });

  it("shows the resolved country under the IP address for a session with one", async () => {
    mockLoadedAccount();
    mockFetchSessions.mockResolvedValue({
      sessions: [
        makeAccountSession({ ip: "192.0.2.10", country: { kind: "resolved", countryCode: "FR" } }),
      ],
    });

    renderWithToast(<AccountPage />);

    await waitFor(() => {
      expect(screen.getByText("192.0.2.10")).toBeTruthy();
    });
    expect(screen.getByText("France")).toBeTruthy();
  });

  it("shows OIDC-only MFA guidance when local password is unavailable", async () => {
    mockFetchAccount.mockResolvedValue({ ...baseAccount, has_local_password: false, roles: [] });
    mockFetchSessions.mockResolvedValue({ sessions: [] });

    renderWithToast(<AccountPage />);
    await waitFor(() => {
      expect(
        screen.getByText(/Two-factor setup requires a local password/i),
      ).toBeTruthy();
    });
    expect(screen.queryByRole("button", { name: "Set up" })).toBeNull();
  });

  it("shows OIDC-only MFA reset guidance alongside the methods list, when already enrolled with no local password", async () => {
    mockFetchAccount.mockResolvedValue({ ...totpEnrolledAccount, has_local_password: false, roles: [] });
    mockFetchSessions.mockResolvedValue({ sessions: [] });

    renderWithToast(<AccountPage />);
    await waitFor(() => {
      expect(
        screen.getByText(/Two-factor reset requires a local password/i),
      ).toBeTruthy();
    });
    expect(screen.getByText("Authenticator app (TOTP)")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Two-factor authentication options" })).toBeNull();
  });

  it("copies the otpauth URI during enrollment", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const originalClipboard = navigator.clipboard;
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    try {
      mockLoadedAccount();
      mockEnrollMfaTotp.mockResolvedValueOnce({
        otpauthUri: "otpauth://totp/Admitto?secret=ABC",
        backupCodes: [],
        backupCodesAlreadyShown: true,
      });

      renderWithToast(<AccountPage />);
      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Set up" })).toBeTruthy();
      });
      fireEvent.click(screen.getByRole("button", { name: "Set up" }));

      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Copy URI" })).toBeTruthy();
      });
      fireEvent.click(screen.getByRole("button", { name: "Copy URI" }));

      await waitFor(() => {
        expect(writeText).toHaveBeenCalledWith("otpauth://totp/Admitto?secret=ABC");
        expect(screen.getByRole("button", { name: "Copied!" })).toBeTruthy();
      });

      vi.advanceTimersByTime(2000);
      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Copy URI" })).toBeTruthy();
      });
    } finally {
      vi.useRealTimers();
      Object.assign(navigator, { clipboard: originalClipboard });
    }
  });

  it("shows the otpauth URI when QR rendering fails", async () => {
    mockLoadedAccount();
    mockEnrollMfaTotp.mockResolvedValueOnce({
      otpauthUri: "otpauth://totp/Admitto?secret=QRFAIL",
      backupCodes: [],
      backupCodesAlreadyShown: true,
    });

    renderWithToast(<AccountPage />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Set up" })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Set up" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Simulate QR fail" })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Simulate QR fail" }));

    await waitFor(() => {
      expect(screen.getByText("otpauth://totp/Admitto?secret=QRFAIL")).toBeTruthy();
    });
  });

  it("hides the QR fallback URI when a later render succeeds", async () => {
    mockLoadedAccount();
    mockEnrollMfaTotp.mockResolvedValueOnce({
      otpauthUri: "otpauth://totp/Admitto?secret=QRRECOVER",
      backupCodes: [],
      backupCodesAlreadyShown: true,
    });

    renderWithToast(<AccountPage />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Set up" })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Set up" }));
    await screen.findByRole("button", { name: "Simulate QR fail" });
    fireEvent.click(screen.getByRole("button", { name: "Simulate QR fail" }));
    expect(await screen.findByText("otpauth://totp/Admitto?secret=QRRECOVER")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Simulate QR ok" }));
    await waitFor(() => {
      expect(screen.queryByText("otpauth://totp/Admitto?secret=QRRECOVER")).toBeNull();
    });
  });

  it("keeps the otpauth URI visible after copy when QR rendering failed", async () => {
    const originalClipboard = navigator.clipboard;
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    try {
      mockLoadedAccount();
      mockEnrollMfaTotp.mockResolvedValueOnce({
        otpauthUri: "otpauth://totp/Admitto?secret=QRCLIP",
        backupCodes: [],
        backupCodesAlreadyShown: true,
      });

      renderWithToast(<AccountPage />);
      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Set up" })).toBeTruthy();
      });
      fireEvent.click(screen.getByRole("button", { name: "Set up" }));
      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Simulate QR fail" })).toBeTruthy();
      });
      fireEvent.click(screen.getByRole("button", { name: "Simulate QR fail" }));
      fireEvent.click(screen.getByRole("button", { name: "Copy URI" }));

      await waitFor(() => {
        expect(writeText).toHaveBeenCalledWith("otpauth://totp/Admitto?secret=QRCLIP");
        expect(screen.getByText("otpauth://totp/Admitto?secret=QRCLIP")).toBeTruthy();
      });
    } finally {
      Object.assign(navigator, { clipboard: originalClipboard });
    }
  });

  it("copies via execCommand when clipboard API is unavailable", async () => {
    const originalClipboard = navigator.clipboard;
    Object.assign(navigator, { clipboard: undefined });
    const originalExecCommand = document.execCommand;
    const execCommand = vi.fn().mockReturnValue(true);
    document.execCommand = execCommand as typeof document.execCommand;

    try {
      mockLoadedAccount();
      mockEnrollMfaTotp.mockResolvedValueOnce({
        otpauthUri: "otpauth://totp/Admitto?secret=EXEC",
        backupCodes: [],
        backupCodesAlreadyShown: true,
      });

      renderWithToast(<AccountPage />);
      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Set up" })).toBeTruthy();
      });
      fireEvent.click(screen.getByRole("button", { name: "Set up" }));
      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Copy URI" })).toBeTruthy();
      });
      fireEvent.click(screen.getByRole("button", { name: "Copy URI" }));

      await waitFor(() => {
        expect(execCommand).toHaveBeenCalledWith("copy");
        expect(screen.getByRole("button", { name: "Copied!" })).toBeTruthy();
      });
    } finally {
      document.execCommand = originalExecCommand;
      Object.assign(navigator, { clipboard: originalClipboard });
    }
  });

  it("continues MFA setup when canceling a missing pending enrollment fails", async () => {
    mockLoadedAccount();
    mockCancelMfaEnroll.mockRejectedValueOnce(new Error("no pending enrollment"));
    mockEnrollMfaTotp.mockResolvedValueOnce({
      otpauthUri: "otpauth://totp/Admitto?secret=ABC",
      backupCodes: [],
      backupCodesAlreadyShown: true,
    });

    renderWithToast(<AccountPage />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Set up" })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Set up" }));

    await waitFor(() => {
      expect(mockCancelMfaEnroll).toHaveBeenCalled();
      expect(mockEnrollMfaTotp).toHaveBeenCalled();
      expect(screen.getByRole("button", { name: "Copy URI" })).toBeTruthy();
    });
  });

  it("shows the otpauth URI when clipboard is unavailable", async () => {
    const originalClipboard = navigator.clipboard;
    Object.assign(navigator, { clipboard: undefined });

    try {
      mockLoadedAccount();
      mockEnrollMfaTotp.mockResolvedValueOnce({
        otpauthUri: "otpauth://totp/Admitto?secret=NOCLIP",
        backupCodes: [],
        backupCodesAlreadyShown: true,
      });

      renderWithToast(<AccountPage />);
      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Set up" })).toBeTruthy();
      });
      fireEvent.click(screen.getByRole("button", { name: "Set up" }));
      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Copy URI" })).toBeTruthy();
      });
      fireEvent.click(screen.getByRole("button", { name: "Copy URI" }));

      await waitFor(() => {
        expect(screen.getByText("otpauth://totp/Admitto?secret=NOCLIP")).toBeTruthy();
      });
    } finally {
      Object.assign(navigator, { clipboard: originalClipboard });
    }
  });

  it("revokes a single other session successfully", async () => {
    const { currentSession, otherSession } = makeCurrentAndOtherSessions();
    mockLoadedAccount();
    mockFetchSessions.mockResolvedValue({ sessions: [currentSession, otherSession] });
    mockDeleteSession.mockResolvedValue(undefined);

    renderWithToast(<AccountPage />);
    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: REVOKE_SESSION_BUTTON }).length).toBeGreaterThan(0);
    });

    const revokeButtons = screen.getAllByRole("button", { name: REVOKE_SESSION_BUTTON });
    const otherRevoke = revokeButtons.find((btn) => !btn.hasAttribute("disabled"));
    expect(otherRevoke).toBeTruthy();
    fireEvent.click(otherRevoke!);
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Revoke" }));

    await waitFor(() => {
      expect(mockDeleteSession).toHaveBeenCalledWith("sess-2");
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });

  it("closes reset confirmation dialog on cancel", async () => {
    mockFetchAccount.mockResolvedValue(totpEnrolledAccount);
    mockFetchSessions.mockResolvedValue({ sessions: [] });

    renderWithToast(<AccountPage />);
    await waitFor(() => {
      expect(within(totpRow()).getByRole("button", { name: "Manage" })).toBeTruthy();
    });

    const dialog = await openResetMfaDialog();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(mockResetMfa).not.toHaveBeenCalled();
  });

  it("shows load account failure", async () => {
    const { ApiError } = await import("../../src/api/client.js");
    mockFetchAccount.mockRejectedValueOnce(new ApiError(500, "secret_internal"));
    mockFetchSessions.mockResolvedValueOnce({ sessions: [] });
    renderWithToast(<AccountPage />);
    await waitFor(() => {
      expect(screen.getByText("Could not load account")).toBeTruthy();
    });
    expect(screen.getByText(/Failed to load account/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    expect(screen.queryByText("secret_internal")).toBeNull();
  });

  it("shows load sessions failure", async () => {
    const { ApiError } = await import("../../src/api/client.js");
    mockFetchAccount.mockResolvedValueOnce(baseAccount);
    mockFetchSessions.mockRejectedValueOnce(new ApiError(500, "secret_internal"));
    renderWithToast(<AccountPage />);
    await waitFor(() => {
      expect(screen.getByText(/Failed to load sessions/)).toBeTruthy();
    });
  });

  it("shows revoke session failure", async () => {
    const { ApiError } = await import("../../src/api/client.js");
    const otherSession = {
      id: "sess-2",
      userId: "usr-1",
      userEmail: "admin@example.com",
      userDisplayName: "Admin",
      role: "superadmin" as const,
      deviceLabel: "Other",
      ip: null,
      country: { kind: "unknown" as const },
      userAgent: null,
      loginAt: "2026-01-01T00:00:00.000Z",
      lastSeenAt: "2026-01-01T01:00:00.000Z",
      expiresAt: "2026-01-02T00:00:00.000Z",
      authMethod: "local",
      stage: "active",
      timezone: null,
      isCurrent: false,
    };
    mockLoadedAccount();
    mockFetchSessions.mockResolvedValue({ sessions: [otherSession] });
    mockDeleteSession.mockRejectedValueOnce(new ApiError(500, "secret_internal"));
    renderWithToast(<AccountPage />);
    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: REVOKE_SESSION_BUTTON }).length).toBeGreaterThan(0);
    });
    fireEvent.click(screen.getAllByRole("button", { name: REVOKE_SESSION_BUTTON })[0]!);
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Revoke" }));
    await waitFor(() => {
      expect(within(dialog).getByText(/Failed to revoke session/)).toBeTruthy();
    });
  });

  it("shows revoke all sessions failure", async () => {
    const { ApiError } = await import("../../src/api/client.js");
    const currentSession = {
      id: "sess-1",
      userId: "usr-1",
      userEmail: "admin@example.com",
      userDisplayName: "Admin",
      role: "superadmin" as const,
      deviceLabel: "This device",
      ip: null,
      country: { kind: "unknown" as const },
      userAgent: null,
      loginAt: "2026-01-01T00:00:00.000Z",
      lastSeenAt: "2026-01-01T01:00:00.000Z",
      expiresAt: "2026-01-02T00:00:00.000Z",
      authMethod: "local",
      stage: "active",
      timezone: null,
      isCurrent: true,
    };
    const otherSession = {
      ...currentSession,
      id: "sess-2",
      deviceLabel: "Other device",
      isCurrent: false,
    };
    mockLoadedAccount();
    mockFetchSessions.mockResolvedValue({ sessions: [currentSession, otherSession] });
    mockDeleteSession.mockRejectedValueOnce(new ApiError(500, "secret_internal"));
    renderWithToast(<AccountPage />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Revoke all other sessions" })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Revoke all other sessions" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Revoke" }));
    await waitFor(() => {
      expect(within(dialog).getByText(/Failed to revoke sessions/)).toBeTruthy();
    });
  });

  it("shows reset 2FA failure", async () => {
    const { ApiError } = await import("../../src/api/client.js");
    mockFetchAccount.mockResolvedValue(totpEnrolledAccount);
    mockFetchSessions.mockResolvedValue({ sessions: [] });
    mockResetMfa.mockRejectedValueOnce(new ApiError(500, "secret_internal"));
    renderWithToast(<AccountPage />);
    await waitFor(() => {
      expect(within(totpRow()).getByRole("button", { name: "Manage" })).toBeTruthy();
    });
    const dialog = await openResetMfaDialog();
    fireEvent.change(within(dialog).getByLabelText("Current password", { selector: "#account-reset-password" }), {
      target: { value: "current-password" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Reset" }));
    await waitFor(() => {
      expect(within(dialog).getByText(/Failed to reset 2FA/)).toBeTruthy();
    });
  });

  it("toasts and reveals the code field when reset requires a step-up code", async () => {
    const { ApiError } = await import("../../src/api/client.js");
    mockFetchAccount.mockResolvedValue(totpEnrolledAccount);
    mockFetchSessions.mockResolvedValue({ sessions: [] });
    mockResetMfa.mockRejectedValueOnce(new ApiError(400, "totp_required", "totp_required"));
    renderWithToast(<AccountPage />);
    await waitFor(() => {
      expect(within(totpRow()).getByRole("button", { name: "Manage" })).toBeTruthy();
    });
    const dialog = await openResetMfaDialog();
    fireEvent.change(within(dialog).getByLabelText("Current password", { selector: "#account-reset-password" }), {
      target: { value: "current-password" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Reset" }));

    // The dialog stays open — progressive disclosure reveals the code field right here (same
    // pattern as the remove-credential dialog), plus a toast explaining why.
    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(
        /Enter your authenticator app code to continue\./,
      );
    });
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(within(dialog).getByLabelText("Authenticator or backup code")).toBeTruthy();
  });

  it("submits the entered step-up code and completes the reset", async () => {
    const { ApiError } = await import("../../src/api/client.js");
    mockFetchAccount
      .mockResolvedValueOnce(totpEnrolledAccount)
      .mockResolvedValueOnce(baseAccount);
    mockFetchSessions.mockResolvedValue({ sessions: [] });
    mockResetMfa
      .mockRejectedValueOnce(new ApiError(400, "totp_required", "totp_required"))
      .mockResolvedValueOnce({ sessions_revoked: 0 });

    renderWithToast(<AccountPage />);
    await waitFor(() => {
      expect(within(totpRow()).getByRole("button", { name: "Manage" })).toBeTruthy();
    });
    const dialog = await openResetMfaDialog();
    fireEvent.change(within(dialog).getByLabelText("Current password", { selector: "#account-reset-password" }), {
      target: { value: "current-password" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Reset" }));
    await waitFor(() => {
      expect(within(dialog).getByLabelText("Authenticator or backup code")).toBeTruthy();
    });
    // Confirm button stays disabled once the code field appears, until a code is entered.
    expect(within(dialog).getByRole("button", { name: "Reset" }).hasAttribute("disabled")).toBe(true);

    fireEvent.change(within(dialog).getByLabelText("Authenticator or backup code"), {
      target: { value: "123456" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Reset" }));

    await waitFor(() => {
      expect(screen.getByText(/Two-factor authentication reset\./)).toBeTruthy();
    });
    expect(mockResetMfa).toHaveBeenLastCalledWith({ password: "current-password", code: "123456" });
  });

  it("clears a stale reset error when the confirm dialog is reopened", async () => {
    const { ApiError } = await import("../../src/api/client.js");
    mockFetchAccount.mockResolvedValue(totpEnrolledAccount);
    mockFetchSessions.mockResolvedValue({ sessions: [] });
    mockResetMfa.mockRejectedValueOnce(new ApiError(500, "secret_internal"));
    renderWithToast(<AccountPage />);
    await waitFor(() => {
      expect(within(totpRow()).getByRole("button", { name: "Manage" })).toBeTruthy();
    });
    let dialog = await openResetMfaDialog();
    fireEvent.change(within(dialog).getByLabelText("Current password", { selector: "#account-reset-password" }), {
      target: { value: "current-password" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Reset" }));
    await waitFor(() => {
      expect(within(dialog).getByText(/Failed to reset 2FA/)).toBeTruthy();
    });

    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    dialog = await openResetMfaDialog();
    expect(within(dialog).queryByText(/Failed to reset 2FA/)).toBeNull();
  });
});

describe("AccountPage profile: phone number", () => {
  it("pre-fills the country code and number from the account, and saves changes to both", async () => {
    mockLoadedAccount({ ...baseAccount, phone_country_code: "+48", phone_number: "500100200" });
    mockPatchProfile.mockResolvedValueOnce({
      display_name: baseAccount.display_name,
      preferred_locale: baseAccount.preferred_locale,
      preferred_time_format: baseAccount.preferred_time_format,
      phone_country_code: "+1",
      phone_number: "5551234",
    });

    renderWithToast(<AccountPage />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Phone country code, Poland \+48/ })).toBeTruthy();
    });
    expect((document.getElementById("account-phone-number") as HTMLInputElement).value).toBe("500100200");

    fireEvent.click(screen.getByRole("button", { name: /Phone country code/ }));
    fireEvent.change(screen.getByLabelText("Search country or dial code"), {
      target: { value: "United States" },
    });
    fireEvent.click(screen.getByRole("button", { name: /United States/ }));
    fireEvent.change(document.getElementById("account-phone-number")!, { target: { value: "5551234" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(mockPatchProfile).toHaveBeenCalledWith({
        phone_country_code: "+1",
        phone_number: "5551234",
      });
    });
  });

  it("sends null for only the field that was cleared (phone fields are diffed independently)", async () => {
    mockLoadedAccount({ ...baseAccount, phone_country_code: "+48", phone_number: "500100200" });
    mockPatchProfile.mockResolvedValueOnce({
      display_name: baseAccount.display_name,
      preferred_locale: baseAccount.preferred_locale,
      preferred_time_format: baseAccount.preferred_time_format,
      phone_country_code: "+48",
      phone_number: null,
    });

    renderWithToast(<AccountPage />);
    await waitFor(() => {
      expect((document.getElementById("account-phone-number") as HTMLInputElement).value).toBe("500100200");
    });

    fireEvent.change(document.getElementById("account-phone-number")!, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(mockPatchProfile).toHaveBeenCalledWith({ phone_number: null });
    });
  });

  it("does not send phone fields when they are unchanged", async () => {
    mockLoadedAccount();
    mockPatchProfile.mockResolvedValueOnce({ ...baseAccount, display_name: "New Name" });

    renderWithToast(<AccountPage />);
    await waitFor(() => {
      expect(screen.getByLabelText("Display name")).toBeTruthy();
    });

    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "New Name" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(mockPatchProfile).toHaveBeenCalledWith({ display_name: "New Name" });
    });
  });
});

describe("AccountPage profile: account type", () => {
  it("shows 'Local account' and the password hint for accounts with only a local password", async () => {
    mockFetchAccount.mockResolvedValue({ ...baseAccount, has_local_password: true, external_identities: [] });
    mockFetchSessions.mockResolvedValue({ sessions: [] });

    renderWithToast(<AccountPage />);
    await waitFor(() => {
      expect(screen.getByText("Local account")).toBeTruthy();
    });
    expect(screen.getByText(/Signed in with a password you set/)).toBeTruthy();
  });

  it("shows 'Managed by <provider>' and the IdP hint for accounts without a local password", async () => {
    mockFetchAccount.mockResolvedValue({
      ...baseAccount,
      has_local_password: false,
      external_identities: [{ id: "ei1", provider_id: "p1", provider_display_name: "Okta", linked_at: "2026-01-01T00:00:00.000Z" }],
    });
    mockFetchSessions.mockResolvedValue({ sessions: [] });

    renderWithToast(<AccountPage />);
    await waitFor(() => {
      expect(screen.getByText("Managed by Okta")).toBeTruthy();
    });
    expect(screen.getByText(/password and two-factor authentication are managed there/)).toBeTruthy();
  });

  it("prioritizes the linked provider and mentions the fallback password when the account has both", async () => {
    mockFetchAccount.mockResolvedValue({
      ...baseAccount,
      has_local_password: true,
      external_identities: [{ id: "ei1", provider_id: "p1", provider_display_name: "Okta", linked_at: "2026-01-01T00:00:00.000Z" }],
    });
    mockFetchSessions.mockResolvedValue({ sessions: [] });

    renderWithToast(<AccountPage />);
    await waitFor(() => {
      expect(screen.getByText("Managed by Okta")).toBeTruthy();
    });
    expect(screen.getByText(/local password available as a fallback/)).toBeTruthy();
  });

  it("joins multiple linked providers by name", async () => {
    mockFetchAccount.mockResolvedValue({
      ...baseAccount,
      has_local_password: false,
      external_identities: [
        { id: "ei1", provider_id: "p1", provider_display_name: "Okta", linked_at: "2026-01-01T00:00:00.000Z" },
        { id: "ei2", provider_id: "p2", provider_display_name: "Authentik", linked_at: "2026-01-02T00:00:00.000Z" },
      ],
    });
    mockFetchSessions.mockResolvedValue({ sessions: [] });

    renderWithToast(<AccountPage />);
    await waitFor(() => {
      expect(screen.getByText("Managed by Okta + Authentik")).toBeTruthy();
    });
  });

  it("shows 'Regional format' label for locale select", async () => {
    mockFetchAccount.mockResolvedValue(baseAccount);
    mockFetchSessions.mockResolvedValue({ sessions: [] });

    renderWithToast(<AccountPage />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /^Regional format,/ })).toBeTruthy();
    });
  });

  it("shows a separate Time format select", async () => {
    mockFetchAccount.mockResolvedValue(baseAccount);
    mockFetchSessions.mockResolvedValue({ sessions: [] });

    renderWithToast(<AccountPage />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /^Time format,/ })).toBeTruthy();
    });
  });
});

const LINKED_ACCOUNT: AccountDto = {
  ...baseAccount,
  has_local_password: false,
  external_identities: [{ id: "ei1", provider_id: "p1", provider_display_name: "Okta", linked_at: "2026-01-01T00:00:00.000Z" }],
};

/** Opens the Profile card's "SSO" menu and clicks one item in it. */
function clickIdentityMenuItem(namePattern: RegExp | string) {
  fireEvent.click(screen.getByRole("button", { name: "SSO" }));
  fireEvent.click(screen.getByRole("menuitem", { name: namePattern }));
}

describe("AccountPage profile: identity provider actions menu", () => {
  it("hides the menu trigger when nothing is linked and no providers are available", async () => {
    mockLoadedAccount();
    renderWithToast(<AccountPage />);
    await waitFor(() => {
      expect(screen.getByText("Local account")).toBeTruthy();
    });
    expect(screen.queryByRole("button", { name: "SSO" })).toBeNull();
  });

  it("shows a Connect item per available provider when nothing is linked yet", async () => {
    vi.stubGlobal("location", { ...window.location, assign: vi.fn() });
    mockFetchAccount.mockResolvedValue({
      ...baseAccount,
      available_identity_providers: [
        { id: "p1", display_name: "Okta" },
        { id: "p2", display_name: "Authentik" },
      ],
    });
    mockFetchSessions.mockResolvedValue({ sessions: [] });
    renderWithToast(<AccountPage />);

    await screen.findByRole("button", { name: "SSO" });
    clickIdentityMenuItem(/Connect Okta/);
    expect(window.location.assign).toHaveBeenCalledWith("/account/oidc/p1/link?next=/account");
  });

  it("shows Unlink SSO and a Connect item together when linked to one provider with another still available", async () => {
    // Accounts can be linked to more than one provider at once (no uniqueness constraint on
    // ExternalIdentity.user_id), so Unlink (for what's linked) and Connect (for what isn't)
    // aren't mutually exclusive states - as long as the account also has a local password, since
    // Connect's re-auth step requires one (see the JIT test right below).
    mockFetchAccount.mockResolvedValue({
      ...LINKED_ACCOUNT,
      has_local_password: true,
      available_identity_providers: [{ id: "p2", display_name: "Authentik" }],
    });
    mockFetchSessions.mockResolvedValue({ sessions: [] });
    renderWithToast(<AccountPage />);

    fireEvent.click(await screen.findByRole("button", { name: "SSO" }));
    expect(screen.getByRole("menuitem", { name: /Unlink SSO/ })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /Connect Authentik/ })).toBeTruthy();
  });

  it("positions the SSO menu with position:fixed so it does not inflate the Profile card header", async () => {
    // Regression: without useDropdownMenu's panelStyle the panel stayed in document flow and
    // stretched .at-card__header around Connect / Unlink (same fixed-panel pattern as
    // UserMoreActionsMenu).
    mockFetchAccount.mockResolvedValue({
      ...baseAccount,
      available_identity_providers: [{ id: "p1", display_name: "Authentik" }],
    });
    mockFetchSessions.mockResolvedValue({ sessions: [] });
    renderWithToast(<AccountPage />);

    fireEvent.click(await screen.findByRole("button", { name: "SSO" }));
    const panel = screen.getByRole("menu");
    expect(panel.style.position).toBe("fixed");
    expect(panel.style.top).not.toBe("");
    expect(panel.style.left).not.toBe("");
  });

  it("hides Connect items for a JIT SSO-only account with no local password, even when providers are available", async () => {
    // /account/oidc/:id/link hard-requires a real local password to re-authenticate, so a JIT
    // account (has_local_password: false) can never finish that flow - only Unlink SSO shows.
    mockFetchAccount.mockResolvedValue({
      ...LINKED_ACCOUNT,
      available_identity_providers: [{ id: "p2", display_name: "Authentik" }],
    });
    mockFetchSessions.mockResolvedValue({ sessions: [] });
    renderWithToast(<AccountPage />);

    fireEvent.click(await screen.findByRole("button", { name: "SSO" }));
    expect(screen.getByRole("menuitem", { name: /Unlink SSO/ })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: /Connect Authentik/ })).toBeNull();
  });
});

describe("AccountPage profile: SSO unlink", () => {
  it("hides the Unlink SSO menu item when no identity is linked", async () => {
    mockLoadedAccount();
    renderWithToast(<AccountPage />);
    await waitFor(() => {
      expect(screen.getByText("Local account")).toBeTruthy();
    });
    expect(screen.queryByRole("button", { name: "SSO" })).toBeNull();
  });

  it("opens a confirm dialog from the menu", async () => {
    mockFetchAccount.mockResolvedValue(LINKED_ACCOUNT);
    mockFetchSessions.mockResolvedValue({ sessions: [] });
    renderWithToast(<AccountPage />);

    await screen.findByRole("button", { name: "SSO" });
    clickIdentityMenuItem(/Unlink SSO/);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Unlink SSO from your account/)).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Unlink" }).hasAttribute("disabled")).toBe(true);
  });

  it("enables the confirm button once the password reaches the minimum length", async () => {
    mockFetchAccount.mockResolvedValue(LINKED_ACCOUNT);
    mockFetchSessions.mockResolvedValue({ sessions: [] });
    renderWithToast(<AccountPage />);

    await screen.findByRole("button", { name: "SSO" });
    clickIdentityMenuItem(/Unlink SSO/);
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("New local password"), { target: { value: "short" } });
    expect(within(dialog).getByRole("button", { name: "Unlink" }).hasAttribute("disabled")).toBe(true);

    fireEvent.change(within(dialog).getByLabelText("New local password"), { target: { value: "long-enough-password" } });
    expect(within(dialog).getByRole("button", { name: "Unlink" }).hasAttribute("disabled")).toBe(false);
  });

  it("cancel clears the password and closes the dialog without calling the API", async () => {
    mockFetchAccount.mockResolvedValue(LINKED_ACCOUNT);
    mockFetchSessions.mockResolvedValue({ sessions: [] });
    renderWithToast(<AccountPage />);

    await screen.findByRole("button", { name: "SSO" });
    clickIdentityMenuItem(/Unlink SSO/);
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("New local password"), { target: { value: "long-enough-password" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(mockUnlinkExternalIdentity).not.toHaveBeenCalled();

    clickIdentityMenuItem(/Unlink SSO/);
    const reopened = await screen.findByRole("dialog");
    expect((within(reopened).getByLabelText("New local password") as HTMLInputElement).value).toBe("");
  });

  it("unlinks successfully, toasts, closes the dialog, and reloads the account", async () => {
    mockFetchAccount.mockResolvedValueOnce(LINKED_ACCOUNT).mockResolvedValue(baseAccount);
    mockFetchSessions.mockResolvedValue({ sessions: [] });
    mockUnlinkExternalIdentity.mockResolvedValueOnce({ ok: true });
    renderWithToast(<AccountPage />);

    await screen.findByRole("button", { name: "SSO" });
    clickIdentityMenuItem(/Unlink SSO/);
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("New local password"), { target: { value: "long-enough-password" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Unlink" }));

    await waitFor(() => {
      expect(screen.getByText("SSO unlinked. Sign in with your new password next time.")).toBeTruthy();
    });
    expect(mockUnlinkExternalIdentity).toHaveBeenCalledWith({ new_password: "long-enough-password", code: undefined });
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => {
      expect(screen.getByText("Local account")).toBeTruthy();
    });
  });

  it("maps invalid_request to a specific password-length error and keeps the dialog open", async () => {
    mockFetchAccount.mockResolvedValue(LINKED_ACCOUNT);
    mockFetchSessions.mockResolvedValue({ sessions: [] });
    const { ApiError } = await import("../../src/api/client.js");
    mockUnlinkExternalIdentity.mockRejectedValueOnce(new ApiError(400, "invalid_request", "invalid_request"));
    renderWithToast(<AccountPage />);

    await screen.findByRole("button", { name: "SSO" });
    clickIdentityMenuItem(/Unlink SSO/);
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("New local password"), { target: { value: "long-enough-password" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Unlink" }));

    await waitFor(() => {
      expect(within(dialog).getByText("Password must be at least 12 characters.")).toBeTruthy();
    });
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("opens a step-up dialog on totp_required", async () => {
    mockFetchAccount.mockResolvedValue(LINKED_ACCOUNT);
    mockFetchSessions.mockResolvedValue({ sessions: [] });
    const { ApiError } = await import("../../src/api/client.js");
    mockUnlinkExternalIdentity.mockRejectedValueOnce(new ApiError(400, "totp_required", "totp_required"));
    renderWithToast(<AccountPage />);

    await screen.findByRole("button", { name: "SSO" });
    clickIdentityMenuItem(/Unlink SSO/);
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("New local password"), { target: { value: "long-enough-password" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Unlink" }));

    await waitFor(() => {
      expect(mockUnlinkExternalIdentity).toHaveBeenCalledTimes(1);
    });
    const stepUpDialog = await screen.findByRole("dialog");
    expect(within(stepUpDialog).getByLabelText("Authenticator or backup code")).toBeTruthy();
  });

  it("shows an inline error in the step-up dialog for a wrong code and keeps it open", async () => {
    mockFetchAccount.mockResolvedValue(LINKED_ACCOUNT);
    mockFetchSessions.mockResolvedValue({ sessions: [] });
    const { ApiError } = await import("../../src/api/client.js");
    mockUnlinkExternalIdentity
      .mockRejectedValueOnce(new ApiError(400, "totp_required", "totp_required"))
      .mockRejectedValueOnce(new ApiError(401, "invalid_totp", "invalid_totp"));
    renderWithToast(<AccountPage />);

    await screen.findByRole("button", { name: "SSO" });
    clickIdentityMenuItem(/Unlink SSO/);
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("New local password"), { target: { value: "long-enough-password" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Unlink" }));
    await waitFor(() => {
      expect(mockUnlinkExternalIdentity).toHaveBeenCalledTimes(1);
    });
    const stepUpDialog = await screen.findByRole("dialog");

    fireEvent.change(within(stepUpDialog).getByLabelText("Authenticator or backup code"), { target: { value: "000000" } });
    fireEvent.click(within(stepUpDialog).getByRole("button", { name: "Unlink" }));

    await waitFor(() => {
      expect(within(stepUpDialog).getByText("Invalid authenticator or backup code.")).toBeTruthy();
    });
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("submits the step-up code and completes the unlink", async () => {
    mockFetchAccount.mockResolvedValueOnce(LINKED_ACCOUNT).mockResolvedValue(baseAccount);
    mockFetchSessions.mockResolvedValue({ sessions: [] });
    const { ApiError } = await import("../../src/api/client.js");
    mockUnlinkExternalIdentity
      .mockRejectedValueOnce(new ApiError(400, "totp_required", "totp_required"))
      .mockResolvedValueOnce({ ok: true });
    renderWithToast(<AccountPage />);

    await screen.findByRole("button", { name: "SSO" });
    clickIdentityMenuItem(/Unlink SSO/);
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("New local password"), { target: { value: "long-enough-password" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Unlink" }));
    await waitFor(() => {
      expect(mockUnlinkExternalIdentity).toHaveBeenCalledTimes(1);
    });
    const stepUpDialog = await screen.findByRole("dialog");

    fireEvent.change(within(stepUpDialog).getByLabelText("Authenticator or backup code"), { target: { value: "123456" } });
    fireEvent.click(within(stepUpDialog).getByRole("button", { name: "Unlink" }));

    await waitFor(() => {
      expect(screen.getByText("SSO unlinked. Sign in with your new password next time.")).toBeTruthy();
    });
    expect(mockUnlinkExternalIdentity).toHaveBeenLastCalledWith({ new_password: "long-enough-password", code: "123456" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes the step-up dialog and toasts on a non-invalid_totp failure", async () => {
    mockFetchAccount.mockResolvedValue(LINKED_ACCOUNT);
    mockFetchSessions.mockResolvedValue({ sessions: [] });
    const { ApiError } = await import("../../src/api/client.js");
    mockUnlinkExternalIdentity
      .mockRejectedValueOnce(new ApiError(400, "totp_required", "totp_required"))
      .mockRejectedValueOnce(new ApiError(429, "too many requests"));
    renderWithToast(<AccountPage />);

    await screen.findByRole("button", { name: "SSO" });
    clickIdentityMenuItem(/Unlink SSO/);
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("New local password"), { target: { value: "long-enough-password" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Unlink" }));
    await waitFor(() => {
      expect(mockUnlinkExternalIdentity).toHaveBeenCalledTimes(1);
    });
    const stepUpDialog = await screen.findByRole("dialog");

    fireEvent.change(within(stepUpDialog).getByLabelText("Authenticator or backup code"), { target: { value: "123456" } });
    fireEvent.click(within(stepUpDialog).getByRole("button", { name: "Unlink" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(screen.getByTestId("at-toast")).toBeTruthy();
  });

  it("requires a current password field when the account has a local password", async () => {
    mockFetchAccount.mockResolvedValue({ ...LINKED_ACCOUNT, has_local_password: true });
    mockFetchSessions.mockResolvedValue({ sessions: [] });
    renderWithToast(<AccountPage />);

    await screen.findByRole("button", { name: "SSO" });
    clickIdentityMenuItem(/Unlink SSO/);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText("Current password")).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText("New local password"), { target: { value: "long-enough-password" } });
    expect(within(dialog).getByRole("button", { name: "Unlink" }).hasAttribute("disabled")).toBe(true);

    fireEvent.change(within(dialog).getByLabelText("Current password"), { target: { value: "old-password" } });
    expect(within(dialog).getByRole("button", { name: "Unlink" }).hasAttribute("disabled")).toBe(false);
  });

  it("sends current_password when the account has a local password", async () => {
    mockFetchAccount.mockResolvedValueOnce({ ...LINKED_ACCOUNT, has_local_password: true }).mockResolvedValue(baseAccount);
    mockFetchSessions.mockResolvedValue({ sessions: [] });
    mockUnlinkExternalIdentity.mockResolvedValueOnce({ ok: true });
    renderWithToast(<AccountPage />);

    await screen.findByRole("button", { name: "SSO" });
    clickIdentityMenuItem(/Unlink SSO/);
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Current password"), { target: { value: "old-password" } });
    fireEvent.change(within(dialog).getByLabelText("New local password"), { target: { value: "long-enough-password" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Unlink" }));

    await waitFor(() => {
      expect(mockUnlinkExternalIdentity).toHaveBeenCalledWith({
        new_password: "long-enough-password",
        current_password: "old-password",
        code: undefined,
      });
    });
  });

  it("maps wrong_password to an inline error and keeps the dialog open", async () => {
    mockFetchAccount.mockResolvedValue({ ...LINKED_ACCOUNT, has_local_password: true });
    mockFetchSessions.mockResolvedValue({ sessions: [] });
    const { ApiError } = await import("../../src/api/client.js");
    mockUnlinkExternalIdentity.mockRejectedValueOnce(new ApiError(401, "wrong_password", "wrong_password"));
    renderWithToast(<AccountPage />);

    await screen.findByRole("button", { name: "SSO" });
    clickIdentityMenuItem(/Unlink SSO/);
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Current password"), { target: { value: "wrong" } });
    fireEvent.change(within(dialog).getByLabelText("New local password"), { target: { value: "long-enough-password" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Unlink" }));

    await waitFor(() => {
      expect(within(dialog).getByText("Current password is incorrect.")).toBeTruthy();
    });
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("closes the dialog and toasts when roles are still managed by the identity provider", async () => {
    mockFetchAccount.mockResolvedValue(LINKED_ACCOUNT);
    mockFetchSessions.mockResolvedValue({ sessions: [] });
    const { ApiError } = await import("../../src/api/client.js");
    mockUnlinkExternalIdentity.mockRejectedValueOnce(
      new ApiError(409, "provider_managed_roles_exist", "provider_managed_roles_exist"),
    );
    renderWithToast(<AccountPage />);

    await screen.findByRole("button", { name: "SSO" });
    clickIdentityMenuItem(/Unlink SSO/);
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("New local password"), { target: { value: "long-enough-password" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Unlink" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(
      screen.getByText(
        "Some of your roles are managed by your identity provider. Ask an administrator to remove them before unlinking SSO.",
      ),
    ).toBeTruthy();

    // Regression: reopening must not still show what was typed before this error closed the dialog.
    clickIdentityMenuItem(/Unlink SSO/);
    const reopened = await screen.findByRole("dialog");
    expect((within(reopened).getByLabelText("New local password") as HTMLInputElement).value).toBe("");
  });

  it("closes the dialog and toasts when the account has no available proof of identity", async () => {
    mockFetchAccount.mockResolvedValue(LINKED_ACCOUNT);
    mockFetchSessions.mockResolvedValue({ sessions: [] });
    const { ApiError } = await import("../../src/api/client.js");
    mockUnlinkExternalIdentity.mockRejectedValueOnce(
      new ApiError(400, "insufficient_verification", "insufficient_verification"),
    );
    renderWithToast(<AccountPage />);

    await screen.findByRole("button", { name: "SSO" });
    clickIdentityMenuItem(/Unlink SSO/);
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("New local password"), { target: { value: "long-enough-password" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Unlink" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(
      screen.getByText(
        "We can't verify it's you without a password or two-factor authentication. Ask an administrator for help unlinking SSO.",
      ),
    ).toBeTruthy();

    // Regression: reopening must not still show what was typed before this error closed the dialog.
    clickIdentityMenuItem(/Unlink SSO/);
    const reopened = await screen.findByRole("dialog");
    expect((within(reopened).getByLabelText("New local password") as HTMLInputElement).value).toBe("");
  });
});

describe("AccountPage profile: email field", () => {
  it("shows the account email in a disabled field, not a plain read-only row", async () => {
    mockLoadedAccount();

    renderWithToast(<AccountPage />);
    const emailField = (await screen.findByLabelText("Email")) as HTMLInputElement;
    expect(emailField.value).toBe("admin@example.com");
    expect(emailField.disabled).toBe(true);
    expect(screen.getByText("Email cannot be changed here.")).toBeTruthy();
  });
});

describe("AccountPage profile: role display", () => {
  it("shows the role in a disabled, read-only control (not editable)", async () => {
    mockFetchAccount.mockResolvedValue({
      ...baseAccount,
      roles: [{ id: "r1", role: "admin", scope_type: "organization", scope_id: "org-1", scope_label: "Acme Events", is_oidc: false }],
    });
    mockFetchSessions.mockResolvedValue({ sessions: [] });

    renderWithToast(<AccountPage />);
    const trigger = await screen.findByRole("button", { name: /Role, Administrator/ });
    expect((trigger as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows an explanatory hint for a superadmin role, with no scope chips", async () => {
    mockFetchAccount.mockResolvedValue({
      ...baseAccount,
      roles: [{ id: "r1", role: "superadmin", scope_type: "instance", scope_id: null, scope_label: null, is_oidc: false }],
    });
    mockFetchSessions.mockResolvedValue({ sessions: [] });

    renderWithToast(<AccountPage />);
    await waitFor(() => {
      expect(screen.getByText("Superadmin")).toBeTruthy();
    });
    expect(screen.getByText(/Superadmin has access to every event and organization/)).toBeTruthy();
    expect(document.querySelector(".account-scope-chip")).toBeNull();
  });

  it("shows one named chip per scope for a non-superadmin role", async () => {
    mockFetchAccount.mockResolvedValue({
      ...baseAccount,
      roles: [
        { id: "r1", role: "admin", scope_type: "organization", scope_id: "org-1", scope_label: "Acme Events", is_oidc: false },
        { id: "r2", role: "admin", scope_type: "organization", scope_id: "org-2", scope_label: "Beta Org", is_oidc: false },
      ],
    });
    mockFetchSessions.mockResolvedValue({ sessions: [] });

    renderWithToast(<AccountPage />);
    await waitFor(() => {
      expect(screen.getByText("Acme Events")).toBeTruthy();
    });
    expect(screen.getByText("Beta Org")).toBeTruthy();
    expect(screen.getByText(/Admin has management access within the organizations/)).toBeTruthy();
  });

  it("marks a chip as identity-provider-managed when that assignment is IdP-sourced", async () => {
    mockFetchAccount.mockResolvedValue({
      ...baseAccount,
      roles: [{ id: "r1", role: "operator", scope_type: "event", scope_id: "evt-1", scope_label: "Autumn Summit", is_oidc: true }],
    });
    mockFetchSessions.mockResolvedValue({ sessions: [] });

    renderWithToast(<AccountPage />);
    await waitFor(() => {
      expect(screen.getByText("Autumn Summit")).toBeTruthy();
    });
    const chip = screen.getByText("Autumn Summit").closest(".account-scope-chip");
    expect(chip?.querySelector(".ti-cloud-lock")).toBeTruthy();
    // The icon is aria-hidden and its title isn't reliably exposed to screen readers or touch/
    // keyboard users, so this distinction also needs real text in the accessibility tree -
    // same sr-only pattern StaffUserListItem already uses for the same "(IdP)" signal.
    expect(chip?.querySelector(".sr-only")?.textContent).toBe("Managed by identity provider");
  });

  it("falls back to the raw scope id when a scope name isn't resolvable", async () => {
    mockFetchAccount.mockResolvedValue({
      ...baseAccount,
      roles: [{ id: "r1", role: "operator", scope_type: "event", scope_id: "evt-deleted", scope_label: null, is_oidc: false }],
    });
    mockFetchSessions.mockResolvedValue({ sessions: [] });

    renderWithToast(<AccountPage />);
    await waitFor(() => {
      expect(screen.getByText("evt-deleted")).toBeTruthy();
    });
  });

  it("shows a plain message when no role is assigned, with no role control", async () => {
    mockFetchAccount.mockResolvedValue({ ...baseAccount, roles: [] });
    mockFetchSessions.mockResolvedValue({ sessions: [] });

    renderWithToast(<AccountPage />);
    await waitFor(() => {
      expect(screen.getByText("No role assigned.")).toBeTruthy();
    });
    expect(screen.queryByRole("button", { name: /^Role,/ })).toBeFalsy();
  });
});

describe("AccountPage: no role assigned", () => {
  it("shows a notice when the account has no role assignments", async () => {
    mockFetchAccount.mockResolvedValue({ ...baseAccount, roles: [] });
    mockFetchSessions.mockResolvedValue({ sessions: [] });

    renderWithToast(<AccountPage />);
    await waitFor(() => {
      expect(screen.getByText(/doesn't have any role assigned yet/)).toBeTruthy();
    });
    // Password/2FA still work with no role — the notice is informational, not a lockout.
    expect(screen.getByLabelText("Current password")).toBeTruthy();
  });

  it("hides the notice once a role is assigned", async () => {
    mockFetchAccount.mockResolvedValue({
      ...baseAccount,
      roles: [{ id: "r1", role: "admin", scope_type: "organization", scope_id: "org-1", is_oidc: false }],
    });
    mockFetchSessions.mockResolvedValue({ sessions: [] });

    renderWithToast(<AccountPage />);
    await waitFor(() => {
      expect(screen.getByText("Role")).toBeTruthy();
    });
    expect(screen.queryByText(/doesn't have any role assigned yet/)).toBeNull();
  });

  it("shows the notice for an admin assignment with no usable scope, even though roles is non-empty", async () => {
    // A corrupt/legacy row: role: "admin" but no organization scope grants nothing, so this
    // account has the same "nothing to access" experience as roles: [] and should get the same
    // notice - a raw roles.length check would miss this (bot review finding).
    mockFetchAccount.mockResolvedValue({
      ...baseAccount,
      roles: [{ id: "r1", role: "admin", scope_type: "organization", scope_id: null, is_oidc: false }],
    });
    mockFetchSessions.mockResolvedValue({ sessions: [] });

    renderWithToast(<AccountPage />);
    await waitFor(() => {
      expect(screen.getByText(/doesn't have any role assigned yet/)).toBeTruthy();
    });
  });

  it("hides the notice for a valid instance-scoped superadmin assignment", async () => {
    mockFetchAccount.mockResolvedValue({
      ...baseAccount,
      roles: [{ id: "r1", role: "superadmin", scope_type: "instance", scope_id: null, is_oidc: false }],
    });
    mockFetchSessions.mockResolvedValue({ sessions: [] });

    renderWithToast(<AccountPage />);
    await waitFor(() => {
      expect(screen.getByText("Role")).toBeTruthy();
    });
    expect(screen.queryByText(/doesn't have any role assigned yet/)).toBeNull();
  });

  it("shows the notice for a superadmin assignment with the wrong scope type", async () => {
    mockFetchAccount.mockResolvedValue({
      ...baseAccount,
      roles: [{ id: "r1", role: "superadmin", scope_type: "organization", scope_id: "org-1", is_oidc: false }],
    });
    mockFetchSessions.mockResolvedValue({ sessions: [] });

    renderWithToast(<AccountPage />);
    await waitFor(() => {
      expect(screen.getByText(/doesn't have any role assigned yet/)).toBeTruthy();
    });
  });

  it("hides the notice for an operator assignment", async () => {
    mockFetchAccount.mockResolvedValue({
      ...baseAccount,
      roles: [{ id: "r1", role: "operator", scope_type: "event", scope_id: "evt-1", is_oidc: false }],
    });
    mockFetchSessions.mockResolvedValue({ sessions: [] });

    renderWithToast(<AccountPage />);
    await waitFor(() => {
      expect(screen.getByText("Role")).toBeTruthy();
    });
    expect(screen.queryByText(/doesn't have any role assigned yet/)).toBeNull();
  });
});

describe("AccountPage: WebAuthn passkeys & security keys", () => {
  /** The row's own "Add"/"Manage" button is just "Add" regardless of which row it's on (the row
   * already names the method), so tests need to scope by the row's container to tell the passkey
   * and security-key rows apart. */
  function passkeyRow(): HTMLElement {
    return screen.getByText("Passkey").closest(".account-mfa-method") as HTMLElement;
  }
  function securityKeyRow(): HTMLElement {
    return screen.getByText("Security key (YubiKey)").closest(".account-mfa-method") as HTMLElement;
  }

  /** Opens the "Add passkey" dialog, fills the required name, and submits it - shared setup
   * for the add-passkey error-code tests below, which only differ in what the mocked API/
   * ceremony call rejects with. */
  async function openAddPasskeyDialogAndSubmit(label = "MacBook Touch ID") {
    fireEvent.click(within(passkeyRow()).getByRole("button", { name: "Add" }));
    const dialog = await screen.findByRole("dialog", { name: "Add passkey" });
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: label } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add" }));
    return dialog;
  }

  it("adds a passkey end to end with a required label", async () => {
    mockFetchAccount
      .mockResolvedValueOnce(baseAccount)
      .mockResolvedValueOnce({ ...baseAccount, mfa_methods: [makeWebauthnMethod()] });
    mockFetchSessions.mockResolvedValue({ sessions: [] });
    mockBeginWebauthnRegistration.mockResolvedValueOnce({ options: FAKE_REGISTRATION_OPTIONS });
    mockStartRegistration.mockResolvedValueOnce(FAKE_REGISTRATION_RESPONSE);
    mockFinishWebauthnRegistration.mockResolvedValueOnce({ ok: true, id: "cred-1", backupCodes: [] });

    renderWithToast(<AccountPage />);
    await waitFor(() => {
      expect(within(passkeyRow()).getByRole("button", { name: "Add" })).toBeTruthy();
    });

    fireEvent.click(within(passkeyRow()).getByRole("button", { name: "Add" }));
    const dialog = await screen.findByRole("dialog", { name: "Add passkey" });
    expect(within(dialog).getByRole("button", { name: "Add" }).hasAttribute("disabled")).toBe(true);

    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "  MacBook Touch ID  " } });
    expect(within(dialog).getByRole("button", { name: "Add" }).hasAttribute("disabled")).toBe(false);
    fireEvent.click(within(dialog).getByRole("button", { name: "Add" }));

    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(/Passkey added\./);
    });
    expect(mockBeginWebauthnRegistration).toHaveBeenCalledWith({ attachment: "platform" });
    expect(mockStartRegistration).toHaveBeenCalledWith({ optionsJSON: FAKE_REGISTRATION_OPTIONS });
    expect(mockFinishWebauthnRegistration).toHaveBeenCalledWith({
      attachment: "platform",
      label: "MacBook Touch ID",
      response: FAKE_REGISTRATION_RESPONSE,
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => {
      expect(screen.getByText("1 registered")).toBeTruthy();
      expect(within(passkeyRow()).getByRole("button", { name: "Manage" })).toBeTruthy();
    });
  });

  it("shows and requires saving the first-ever batch of backup codes when adding a passkey", async () => {
    mockFetchAccount
      .mockResolvedValueOnce(baseAccount)
      .mockResolvedValueOnce({ ...baseAccount, mfa_methods: [makeWebauthnMethod()] });
    mockFetchSessions.mockResolvedValue({ sessions: [] });
    mockBeginWebauthnRegistration.mockResolvedValueOnce({ options: FAKE_REGISTRATION_OPTIONS });
    mockStartRegistration.mockResolvedValueOnce(FAKE_REGISTRATION_RESPONSE);
    const codes = Array.from({ length: BACKUP_RECOVERY_CODE_COUNT }, (_, i) => `NEW-CODE-${i}`);
    mockFinishWebauthnRegistration.mockResolvedValueOnce({ ok: true, id: "cred-1", backupCodes: codes });

    renderWithToast(<AccountPage />);
    await waitFor(() => {
      expect(within(passkeyRow()).getByRole("button", { name: "Add" })).toBeTruthy();
    });
    fireEvent.click(within(passkeyRow()).getByRole("button", { name: "Add" }));
    const dialog = await screen.findByRole("dialog", { name: "Add passkey" });
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "MacBook Touch ID" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add" }));

    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(/Passkey added\./);
    });
    // Toasting/confirming the passkey doesn't close the dialog - the backup codes still need
    // to be saved first, same as first-time TOTP setup.
    expect(within(dialog).getByText(`Backup codes: save all ${codes.length}, shown once`)).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Add" }).hasAttribute("disabled")).toBe(true);

    // Cannot dismiss (even via the backdrop) until the checkbox is checked.
    fireEvent.click(document.querySelector(".at-modal-backdrop")!);
    expect(screen.getByRole("dialog", { name: "Add passkey" })).toBeTruthy();

    fireEvent.click(within(dialog).getByLabelText("I've saved my backup codes"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("adds a security key end to end", async () => {
    mockFetchAccount
      .mockResolvedValueOnce(baseAccount)
      .mockResolvedValueOnce({
        ...baseAccount,
        mfa_methods: [makeWebauthnMethod({ id: "cred-2", label: "YubiKey 5C", attachment: "cross-platform" })],
      });
    mockFetchSessions.mockResolvedValue({ sessions: [] });
    mockBeginWebauthnRegistration.mockResolvedValueOnce({ options: FAKE_REGISTRATION_OPTIONS });
    mockStartRegistration.mockResolvedValueOnce(FAKE_REGISTRATION_RESPONSE);
    mockFinishWebauthnRegistration.mockResolvedValueOnce({ ok: true, id: "cred-2", backupCodes: [] });

    renderWithToast(<AccountPage />);
    await waitFor(() => {
      expect(within(securityKeyRow()).getByRole("button", { name: "Add" })).toBeTruthy();
    });

    fireEvent.click(within(securityKeyRow()).getByRole("button", { name: "Add" }));
    const dialog = await screen.findByRole("dialog", { name: "Add security key" });
    expect(within(dialog).getByLabelText("Name").getAttribute("placeholder")).toBe("e.g. YubiKey 5C");
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "YubiKey 5C" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add" }));

    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(/Security key added\./);
    });
    expect(mockBeginWebauthnRegistration).toHaveBeenCalledWith({ attachment: "cross-platform" });
    expect(mockFinishWebauthnRegistration).toHaveBeenCalledWith({
      attachment: "cross-platform",
      label: "YubiKey 5C",
      response: FAKE_REGISTRATION_RESPONSE,
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows and requires saving the first-ever batch of backup codes when adding a security key", async () => {
    mockFetchAccount
      .mockResolvedValueOnce(baseAccount)
      .mockResolvedValueOnce({
        ...baseAccount,
        mfa_methods: [makeWebauthnMethod({ attachment: "cross-platform" })],
      });
    mockFetchSessions.mockResolvedValue({ sessions: [] });
    mockBeginWebauthnRegistration.mockResolvedValueOnce({ options: FAKE_REGISTRATION_OPTIONS });
    mockStartRegistration.mockResolvedValueOnce(FAKE_REGISTRATION_RESPONSE);
    const codes = Array.from({ length: BACKUP_RECOVERY_CODE_COUNT }, (_, i) => `NEW-CODE-${i}`);
    mockFinishWebauthnRegistration.mockResolvedValueOnce({ ok: true, id: "cred-2", backupCodes: codes });

    renderWithToast(<AccountPage />);
    await waitFor(() => {
      expect(within(securityKeyRow()).getByRole("button", { name: "Add" })).toBeTruthy();
    });
    fireEvent.click(within(securityKeyRow()).getByRole("button", { name: "Add" }));
    const dialog = await screen.findByRole("dialog", { name: "Add security key" });
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "YubiKey 5C" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add" }));

    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(/Security key added\./);
    });
    expect(within(dialog).getByText(`Backup codes: save all ${codes.length}, shown once`)).toBeTruthy();

    fireEvent.click(document.querySelector(".at-modal-backdrop")!);
    expect(screen.getByRole("dialog", { name: "Add security key" })).toBeTruthy();

    fireEvent.click(within(dialog).getByLabelText("I've saved my backup codes"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("surfaces a server API error when adding a security key", async () => {
    mockLoadedAccount({ ...baseAccount, webauthn_enabled: true });
    const { ApiError } = await import("../../src/api/client.js");
    mockBeginWebauthnRegistration.mockRejectedValueOnce(new ApiError(403, "webauthn_disabled", "webauthn_disabled"));

    renderWithToast(<AccountPage />);
    await waitFor(() => {
      expect(within(securityKeyRow()).getByRole("button", { name: "Add" })).toBeTruthy();
    });
    fireEvent.click(within(securityKeyRow()).getByRole("button", { name: "Add" }));
    const dialog = await screen.findByRole("dialog", { name: "Add security key" });
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "YubiKey 5C" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add" }));

    await waitFor(() => {
      expect(
        within(dialog).getByText(
          "Passkeys and security keys are turned off for this instance. Ask an administrator to enable them.",
        ),
      ).toBeTruthy();
    });
  });

  it("shows a friendly message when the security-key browser ceremony is cancelled", async () => {
    mockLoadedAccount({ ...baseAccount, webauthn_enabled: true });
    mockBeginWebauthnRegistration.mockResolvedValueOnce({ options: FAKE_REGISTRATION_OPTIONS });
    const cancelled = Object.assign(new Error("The operation either timed out or was not allowed."), {
      name: "NotAllowedError",
    });
    mockStartRegistration.mockRejectedValueOnce(cancelled);

    renderWithToast(<AccountPage />);
    await waitFor(() => {
      expect(within(securityKeyRow()).getByRole("button", { name: "Add" })).toBeTruthy();
    });
    fireEvent.click(within(securityKeyRow()).getByRole("button", { name: "Add" }));
    const dialog = await screen.findByRole("dialog", { name: "Add security key" });
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "YubiKey 5C" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add" }));

    await waitFor(() => {
      expect(within(dialog).getByText("Setup was cancelled.")).toBeTruthy();
    });
    expect(mockFinishWebauthnRegistration).not.toHaveBeenCalled();
  });

  it("Cancel dismisses the Add passkey dialog without registering", async () => {
    mockLoadedAccount({ ...baseAccount, webauthn_enabled: true });

    renderWithToast(<AccountPage />);
    await waitFor(() => {
      expect(within(passkeyRow()).getByRole("button", { name: "Add" })).toBeTruthy();
    });
    fireEvent.click(within(passkeyRow()).getByRole("button", { name: "Add" }));
    const dialog = await screen.findByRole("dialog", { name: "Add passkey" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mockBeginWebauthnRegistration).not.toHaveBeenCalled();
  });

  it("Cancel dismisses the Add security key dialog without registering", async () => {
    mockLoadedAccount({ ...baseAccount, webauthn_enabled: true });

    renderWithToast(<AccountPage />);
    await waitFor(() => {
      expect(within(securityKeyRow()).getByRole("button", { name: "Add" })).toBeTruthy();
    });
    fireEvent.click(within(securityKeyRow()).getByRole("button", { name: "Add" }));
    const dialog = await screen.findByRole("dialog", { name: "Add security key" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mockBeginWebauthnRegistration).not.toHaveBeenCalled();
  });

  it("clicking outside the Add passkey dialog while adding does not dismiss it", async () => {
    mockLoadedAccount({ ...baseAccount, webauthn_enabled: true });
    mockBeginWebauthnRegistration.mockImplementationOnce(() => new Promise(() => {}));

    renderWithToast(<AccountPage />);
    await waitFor(() => {
      expect(within(passkeyRow()).getByRole("button", { name: "Add" })).toBeTruthy();
    });
    fireEvent.click(within(passkeyRow()).getByRole("button", { name: "Add" }));
    const dialog = await screen.findByRole("dialog", { name: "Add passkey" });
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "MacBook Touch ID" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add" }));
    await waitFor(() => {
      expect(within(dialog).getByRole("button", { name: "Cancel" }).hasAttribute("disabled")).toBe(true);
    });

    fireEvent.click(document.querySelector(".at-modal-backdrop")!);

    expect(screen.getByRole("dialog", { name: "Add passkey" })).toBeTruthy();
  });

  it("clicking outside the Add security key dialog while adding does not dismiss it", async () => {
    mockLoadedAccount({ ...baseAccount, webauthn_enabled: true });
    mockBeginWebauthnRegistration.mockImplementationOnce(() => new Promise(() => {}));

    renderWithToast(<AccountPage />);
    await waitFor(() => {
      expect(within(securityKeyRow()).getByRole("button", { name: "Add" })).toBeTruthy();
    });
    fireEvent.click(within(securityKeyRow()).getByRole("button", { name: "Add" }));
    const dialog = await screen.findByRole("dialog", { name: "Add security key" });
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "YubiKey 5C" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add" }));
    await waitFor(() => {
      expect(within(dialog).getByRole("button", { name: "Cancel" }).hasAttribute("disabled")).toBe(true);
    });

    fireEvent.click(document.querySelector(".at-modal-backdrop")!);

    expect(screen.getByRole("dialog", { name: "Add security key" })).toBeTruthy();
  });

  it("surfaces the webauthn_disabled error from the server", async () => {
    mockLoadedAccount({ ...baseAccount, webauthn_enabled: true });
    const { ApiError } = await import("../../src/api/client.js");
    mockBeginWebauthnRegistration.mockRejectedValueOnce(new ApiError(403, "webauthn_disabled", "webauthn_disabled"));

    renderWithToast(<AccountPage />);
    await waitFor(() => {
      expect(within(passkeyRow()).getByRole("button", { name: "Add" })).toBeTruthy();
    });
    const dialog = await openAddPasskeyDialogAndSubmit();

    await waitFor(() => {
      expect(
        within(dialog).getByText(
          "Passkeys and security keys are turned off for this instance. Ask an administrator to enable them.",
        ),
      ).toBeTruthy();
    });
    expect(mockStartRegistration).not.toHaveBeenCalled();
  });

  it("surfaces the no_local_password error from the server", async () => {
    mockLoadedAccount({ ...baseAccount, webauthn_enabled: true });
    const { ApiError } = await import("../../src/api/client.js");
    mockBeginWebauthnRegistration.mockRejectedValueOnce(new ApiError(400, "no_local_password", "no_local_password"));

    renderWithToast(<AccountPage />);
    await waitFor(() => {
      expect(within(passkeyRow()).getByRole("button", { name: "Add" })).toBeTruthy();
    });
    const dialog = await openAddPasskeyDialogAndSubmit();

    await waitFor(() => {
      expect(within(dialog).getByText("Password is managed by your identity provider.")).toBeTruthy();
    });
  });

  it("surfaces the challenge_expired error from the server", async () => {
    mockLoadedAccount({ ...baseAccount, webauthn_enabled: true });
    const { ApiError } = await import("../../src/api/client.js");
    mockBeginWebauthnRegistration.mockResolvedValueOnce({ options: FAKE_REGISTRATION_OPTIONS });
    mockStartRegistration.mockResolvedValueOnce(FAKE_REGISTRATION_RESPONSE);
    mockFinishWebauthnRegistration.mockRejectedValueOnce(new ApiError(400, "challenge_expired", "challenge_expired"));

    renderWithToast(<AccountPage />);
    await waitFor(() => {
      expect(within(passkeyRow()).getByRole("button", { name: "Add" })).toBeTruthy();
    });
    const dialog = await openAddPasskeyDialogAndSubmit();

    await waitFor(() => {
      expect(within(dialog).getByText("This passkey/security key setup request expired. Start again.")).toBeTruthy();
    });
  });

  it("surfaces the verification_failed error from the server", async () => {
    mockLoadedAccount({ ...baseAccount, webauthn_enabled: true });
    const { ApiError } = await import("../../src/api/client.js");
    mockBeginWebauthnRegistration.mockResolvedValueOnce({ options: FAKE_REGISTRATION_OPTIONS });
    mockStartRegistration.mockResolvedValueOnce(FAKE_REGISTRATION_RESPONSE);
    mockFinishWebauthnRegistration.mockRejectedValueOnce(new ApiError(400, "verification_failed", "verification_failed"));

    renderWithToast(<AccountPage />);
    await waitFor(() => {
      expect(within(passkeyRow()).getByRole("button", { name: "Add" })).toBeTruthy();
    });
    const dialog = await openAddPasskeyDialogAndSubmit();

    await waitFor(() => {
      expect(within(dialog).getByText("Could not verify the passkey/security key. Try again.")).toBeTruthy();
    });
  });

  it("shows a friendly message when the browser ceremony is cancelled, without calling finish", async () => {
    mockLoadedAccount({ ...baseAccount, webauthn_enabled: true });
    mockBeginWebauthnRegistration.mockResolvedValueOnce({ options: FAKE_REGISTRATION_OPTIONS });
    // A real browser's DOMException is an Error subclass (webauthnCeremonyErrorMessage checks
    // `err instanceof Error`) - jsdom's own DOMException isn't, so build a stand-in that matches
    // real-browser shape instead of `new DOMException(...)`, which would false-negative here.
    const cancelled = Object.assign(new Error("The operation either timed out or was not allowed."), {
      name: "NotAllowedError",
    });
    mockStartRegistration.mockRejectedValueOnce(cancelled);

    renderWithToast(<AccountPage />);
    await waitFor(() => {
      expect(within(passkeyRow()).getByRole("button", { name: "Add" })).toBeTruthy();
    });
    const dialog = await openAddPasskeyDialogAndSubmit();

    await waitFor(() => {
      expect(within(dialog).getByText("Setup was cancelled.")).toBeTruthy();
    });
    expect(mockFinishWebauthnRegistration).not.toHaveBeenCalled();
  });

  it("shows a generic message for other browser ceremony failures", async () => {
    mockLoadedAccount({ ...baseAccount, webauthn_enabled: true });
    mockBeginWebauthnRegistration.mockResolvedValueOnce({ options: FAKE_REGISTRATION_OPTIONS });
    mockStartRegistration.mockRejectedValueOnce(new Error("authenticator not supported"));

    renderWithToast(<AccountPage />);
    await waitFor(() => {
      expect(within(passkeyRow()).getByRole("button", { name: "Add" })).toBeTruthy();
    });
    const dialog = await openAddPasskeyDialogAndSubmit();

    await waitFor(() => {
      expect(within(dialog).getByText("Could not complete the setup in your browser. Try again.")).toBeTruthy();
    });
  });

  it("shows the same generic message when the browser rejects with a non-Error value", async () => {
    mockLoadedAccount({ ...baseAccount, webauthn_enabled: true });
    mockBeginWebauthnRegistration.mockResolvedValueOnce({ options: FAKE_REGISTRATION_OPTIONS });
    // jsdom's own DOMException isn't an Error instance (unlike a real browser's) - a natural,
    // non-contrived way to exercise webauthnCeremonyErrorMessage's `err instanceof Error` false
    // branch, same fallback text as any other non-Error rejection.
    mockStartRegistration.mockRejectedValueOnce(new DOMException("aborted"));

    renderWithToast(<AccountPage />);
    await waitFor(() => {
      expect(within(passkeyRow()).getByRole("button", { name: "Add" })).toBeTruthy();
    });
    const dialog = await openAddPasskeyDialogAndSubmit();

    await waitFor(() => {
      expect(within(dialog).getByText("Could not complete the setup in your browser. Try again.")).toBeTruthy();
    });
  });

  it("Add from within the Manage passkeys dialog opens Add passkey", async () => {
    mockLoadedAccount({ ...baseAccount, mfa_methods: [makeWebauthnMethod()] });

    renderWithToast(<AccountPage />);
    await waitFor(() => {
      expect(within(passkeyRow()).getByRole("button", { name: "Manage" })).toBeTruthy();
    });
    fireEvent.click(within(passkeyRow()).getByRole("button", { name: "Manage" }));
    const manageDialog = await screen.findByRole("dialog", { name: "Manage passkeys" });
    fireEvent.click(within(manageDialog).getByRole("button", { name: "Add" }));

    expect(await screen.findByRole("dialog", { name: "Add passkey" })).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: "Manage passkeys" })).toBeNull();
  });

  it("Add from within the Manage security keys dialog opens Add security key", async () => {
    mockLoadedAccount({
      ...baseAccount,
      mfa_methods: [makeWebauthnMethod({ attachment: "cross-platform" })],
    });

    renderWithToast(<AccountPage />);
    await waitFor(() => {
      expect(within(securityKeyRow()).getByRole("button", { name: "Manage" })).toBeTruthy();
    });
    fireEvent.click(within(securityKeyRow()).getByRole("button", { name: "Manage" }));
    const manageDialog = await screen.findByRole("dialog", { name: "Manage security keys" });
    fireEvent.click(within(manageDialog).getByRole("button", { name: "Add" }));

    expect(await screen.findByRole("dialog", { name: "Add security key" })).toBeTruthy();
  });

  it("Close dismisses the Manage passkeys dialog", async () => {
    mockLoadedAccount({ ...baseAccount, mfa_methods: [makeWebauthnMethod()] });

    renderWithToast(<AccountPage />);
    await waitFor(() => {
      expect(within(passkeyRow()).getByRole("button", { name: "Manage" })).toBeTruthy();
    });
    fireEvent.click(within(passkeyRow()).getByRole("button", { name: "Manage" }));
    const manageDialog = await screen.findByRole("dialog", { name: "Manage passkeys" });
    fireEvent.click(within(manageDialog).getByRole("button", { name: "Close" }));

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows Never used for a credential that has never been used", async () => {
    mockLoadedAccount({ ...baseAccount, mfa_methods: [makeWebauthnMethod({ last_used_at: null })] });

    renderWithToast(<AccountPage />);
    await waitFor(() => {
      expect(within(passkeyRow()).getByRole("button", { name: "Manage" })).toBeTruthy();
    });
    fireEvent.click(within(passkeyRow()).getByRole("button", { name: "Manage" }));
    const dialog = await screen.findByRole("dialog", { name: "Manage passkeys" });
    expect(within(dialog).getByText("Never used")).toBeTruthy();
  });

  it("falls back to a generic name for an unlabeled passkey", async () => {
    mockLoadedAccount({ ...baseAccount, mfa_methods: [makeWebauthnMethod({ label: null })] });

    renderWithToast(<AccountPage />);
    await waitFor(() => {
      expect(within(passkeyRow()).getByRole("button", { name: "Manage" })).toBeTruthy();
    });
    fireEvent.click(within(passkeyRow()).getByRole("button", { name: "Manage" }));
    const dialog = await screen.findByRole("dialog", { name: "Manage passkeys" });
    expect(within(dialog).getByText("Passkey")).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Remove passkey" })).toBeTruthy();
  });

  it("removes a credential without a step-up code", async () => {
    const account: AccountDto = {
      ...baseAccount,
      mfa_methods: [
        { type: "totp", confirmed: true, last_used_at: null },
        makeWebauthnMethod({ last_used_at: "2026-08-01T00:00:00.000Z" }),
      ],
    };
    mockFetchAccount
      .mockResolvedValueOnce(account)
      .mockResolvedValueOnce({ ...account, mfa_methods: [account.mfa_methods[0]!] });
    mockFetchSessions.mockResolvedValue({ sessions: [] });
    mockDeleteWebauthnCredential.mockResolvedValueOnce({ ok: true });

    renderWithToast(<AccountPage />);
    await waitFor(() => {
      expect(within(passkeyRow()).getByRole("button", { name: "Manage" })).toBeTruthy();
    });
    fireEvent.click(within(passkeyRow()).getByRole("button", { name: "Manage" }));
    const manageDialog = await screen.findByRole("dialog", { name: "Manage passkeys" });
    expect(within(manageDialog).getByText("MacBook Touch ID")).toBeTruthy();
    expect(within(manageDialog).getByText(/^Last used/)).toBeTruthy();

    fireEvent.click(within(manageDialog).getByRole("button", { name: "Remove MacBook Touch ID" }));
    const dialog = await screen.findByRole("dialog", { name: "Remove passkey" });
    expect(
      within(dialog).getByText('Remove "MacBook Touch ID"? You can register another passkey any time.'),
    ).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }));

    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(/"MacBook Touch ID" removed\./);
    });
    expect(mockDeleteWebauthnCredential).toHaveBeenCalledWith("cred-1", undefined);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("removes a credential that requires a step-up code, revealing the code field in the same dialog", async () => {
    const account: AccountDto = {
      ...baseAccount,
      mfa_methods: [
        { type: "totp", confirmed: true, last_used_at: null },
        makeWebauthnMethod(),
      ],
    };
    mockFetchAccount.mockResolvedValue(account);
    mockFetchSessions.mockResolvedValue({ sessions: [] });
    const { ApiError } = await import("../../src/api/client.js");
    mockDeleteWebauthnCredential
      .mockRejectedValueOnce(new ApiError(400, "totp_required", "totp_required"))
      .mockResolvedValueOnce({ ok: true });

    renderWithToast(<AccountPage />);
    await waitFor(() => {
      expect(within(passkeyRow()).getByRole("button", { name: "Manage" })).toBeTruthy();
    });
    fireEvent.click(within(passkeyRow()).getByRole("button", { name: "Manage" }));
    const manageDialog = await screen.findByRole("dialog", { name: "Manage passkeys" });
    fireEvent.click(within(manageDialog).getByRole("button", { name: "Remove MacBook Touch ID" }));
    const dialog = await screen.findByRole("dialog", { name: "Remove passkey" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }));

    await waitFor(() => {
      expect(within(dialog).getByLabelText("Authenticator or backup code")).toBeTruthy();
    });
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Remove" }).hasAttribute("disabled")).toBe(true);

    fireEvent.change(within(dialog).getByLabelText("Authenticator or backup code"), {
      target: { value: "123456" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(mockDeleteWebauthnCredential).toHaveBeenLastCalledWith("cred-1", { code: "123456" });
  });

  it("refreshes the backup codes status after removing a credential with a step-up code", async () => {
    const account: AccountDto = {
      ...baseAccount,
      mfa_methods: [
        { type: "totp", confirmed: true, last_used_at: null },
        makeWebauthnMethod(),
      ],
    };
    mockFetchAccount.mockResolvedValue(account);
    mockFetchSessions.mockResolvedValue({ sessions: [] });
    mockFetchBackupCodesStatus
      .mockResolvedValueOnce({ total: 10, remaining: 10 })
      .mockResolvedValueOnce({ total: 10, remaining: 9 });
    const { ApiError } = await import("../../src/api/client.js");
    mockDeleteWebauthnCredential
      .mockRejectedValueOnce(new ApiError(400, "totp_required", "totp_required"))
      .mockResolvedValueOnce({ ok: true });

    renderWithToast(<AccountPage />);
    await waitFor(() => {
      expect(within(passkeyRow()).getByRole("button", { name: "Manage" })).toBeTruthy();
    });
    fireEvent.click(within(passkeyRow()).getByRole("button", { name: "Manage" }));
    const manageDialog = await screen.findByRole("dialog", { name: "Manage passkeys" });
    fireEvent.click(within(manageDialog).getByRole("button", { name: "Remove MacBook Touch ID" }));
    const dialog = await screen.findByRole("dialog", { name: "Remove passkey" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }));
    await waitFor(() => {
      expect(within(dialog).getByLabelText("Authenticator or backup code")).toBeTruthy();
    });
    fireEvent.change(within(dialog).getByLabelText("Authenticator or backup code"), {
      target: { value: "a-backup-code" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }));

    await waitFor(() => {
      expect(mockFetchBackupCodesStatus).toHaveBeenCalledTimes(2);
    });
  });

  it("shows an inline error for a non-step-up credential removal failure", async () => {
    mockLoadedAccount({
      ...baseAccount,
      mfa_methods: [
        { type: "totp", confirmed: true, last_used_at: null },
        makeWebauthnMethod(),
      ],
    });
    mockDeleteWebauthnCredential.mockRejectedValueOnce(new Error("network down"));

    renderWithToast(<AccountPage />);
    await waitFor(() => {
      expect(within(passkeyRow()).getByRole("button", { name: "Manage" })).toBeTruthy();
    });
    fireEvent.click(within(passkeyRow()).getByRole("button", { name: "Manage" }));
    const manageDialog = await screen.findByRole("dialog", { name: "Manage passkeys" });
    fireEvent.click(within(manageDialog).getByRole("button", { name: "Remove MacBook Touch ID" }));
    const dialog = await screen.findByRole("dialog", { name: "Remove passkey" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }));

    await waitFor(() => {
      expect(within(dialog).getByText("Failed to remove credential.")).toBeTruthy();
    });
  });

  it("Cancel dismisses the Remove credential dialog without removing it", async () => {
    mockLoadedAccount({
      ...baseAccount,
      mfa_methods: [
        { type: "totp", confirmed: true, last_used_at: null },
        makeWebauthnMethod(),
      ],
    });

    renderWithToast(<AccountPage />);
    await waitFor(() => {
      expect(within(passkeyRow()).getByRole("button", { name: "Manage" })).toBeTruthy();
    });
    fireEvent.click(within(passkeyRow()).getByRole("button", { name: "Manage" }));
    const manageDialog = await screen.findByRole("dialog", { name: "Manage passkeys" });
    fireEvent.click(within(manageDialog).getByRole("button", { name: "Remove MacBook Touch ID" }));
    const dialog = await screen.findByRole("dialog", { name: "Remove passkey" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mockDeleteWebauthnCredential).not.toHaveBeenCalled();
  });

  it("clicking outside the Remove credential dialog while removing does not dismiss it", async () => {
    mockLoadedAccount({
      ...baseAccount,
      mfa_methods: [
        { type: "totp", confirmed: true, last_used_at: null },
        makeWebauthnMethod(),
      ],
    });
    mockDeleteWebauthnCredential.mockImplementationOnce(() => new Promise(() => {}));

    renderWithToast(<AccountPage />);
    await waitFor(() => {
      expect(within(passkeyRow()).getByRole("button", { name: "Manage" })).toBeTruthy();
    });
    fireEvent.click(within(passkeyRow()).getByRole("button", { name: "Manage" }));
    const manageDialog = await screen.findByRole("dialog", { name: "Manage passkeys" });
    fireEvent.click(within(manageDialog).getByRole("button", { name: "Remove MacBook Touch ID" }));
    const dialog = await screen.findByRole("dialog", { name: "Remove passkey" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }));
    await waitFor(() => {
      expect(within(dialog).getByRole("button", { name: "Cancel" }).hasAttribute("disabled")).toBe(true);
    });

    fireEvent.click(document.querySelector(".at-modal-backdrop")!);

    expect(screen.getByRole("dialog", { name: "Remove passkey" })).toBeTruthy();
  });

  it("warns that removing the only confirmed method leaves the account without two-factor authentication", async () => {
    mockLoadedAccount({ ...baseAccount, mfa_methods: [makeWebauthnMethod()] });

    renderWithToast(<AccountPage />);
    await waitFor(() => {
      expect(within(passkeyRow()).getByRole("button", { name: "Manage" })).toBeTruthy();
    });
    fireEvent.click(within(passkeyRow()).getByRole("button", { name: "Manage" }));
    const manageDialog = await screen.findByRole("dialog", { name: "Manage passkeys" });
    fireEvent.click(within(manageDialog).getByRole("button", { name: "Remove MacBook Touch ID" }));
    const dialog = await screen.findByRole("dialog", { name: "Remove passkey" });
    expect(
      within(dialog).getByText('Remove "MacBook Touch ID"? You can register another passkey any time.'),
    ).toBeTruthy();
    expect(
      within(dialog).getByText(
        "This is your last two-factor method. You will need to set one up again the next time you sign in.",
      ),
    ).toBeTruthy();
  });

  it("does not show the last-remaining-method warning when another confirmed method remains", async () => {
    mockLoadedAccount({
      ...baseAccount,
      mfa_methods: [
        { type: "totp", confirmed: true, last_used_at: null },
        makeWebauthnMethod(),
      ],
    });

    renderWithToast(<AccountPage />);
    await waitFor(() => {
      expect(within(passkeyRow()).getByRole("button", { name: "Manage" })).toBeTruthy();
    });
    fireEvent.click(within(passkeyRow()).getByRole("button", { name: "Manage" }));
    const manageDialog = await screen.findByRole("dialog", { name: "Manage passkeys" });
    fireEvent.click(within(manageDialog).getByRole("button", { name: "Remove MacBook Touch ID" }));
    const dialog = await screen.findByRole("dialog", { name: "Remove passkey" });
    expect(within(dialog).queryByText(/This is your last two-factor method/)).toBeNull();
    expect(
      within(dialog).getByText('Remove "MacBook Touch ID"? You can register another passkey any time.'),
    ).toBeTruthy();
  });

  it("manages and removes an unlabeled security key (the security-key/no-label side of the shared passkey UI)", async () => {
    const account: AccountDto = {
      ...baseAccount,
      mfa_methods: [
        { type: "totp", confirmed: true, last_used_at: null },
        makeWebauthnMethod({
          id: "cred-2",
          label: null,
          attachment: "cross-platform",
          last_used_at: "2026-08-01T00:00:00.000Z",
        }),
      ],
    };
    mockFetchAccount
      .mockResolvedValueOnce(account)
      .mockResolvedValueOnce({ ...account, mfa_methods: [account.mfa_methods[0]!] });
    mockFetchSessions.mockResolvedValue({ sessions: [] });
    mockDeleteWebauthnCredential.mockResolvedValueOnce({ ok: true });

    renderWithToast(<AccountPage />);
    await waitFor(() => {
      expect(within(securityKeyRow()).getByRole("button", { name: "Manage" })).toBeTruthy();
    });
    fireEvent.click(within(securityKeyRow()).getByRole("button", { name: "Manage" }));
    const manageDialog = await screen.findByRole("dialog", { name: "Manage security keys" });
    expect(within(manageDialog).getByText("Security key")).toBeTruthy();

    fireEvent.click(within(manageDialog).getByRole("button", { name: "Remove security key" }));
    const dialog = await screen.findByRole("dialog", { name: "Remove security key" });
    expect(
      within(dialog).getByText("Remove this security key? You can register another security key any time."),
    ).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }));

    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(/Credential removed\./);
    });
    expect(mockDeleteWebauthnCredential).toHaveBeenCalledWith("cred-2", undefined);
  });

  it("hides Add passkey/Add security key and shows a note when webauthn is disabled for the instance", async () => {
    mockLoadedAccount({ ...baseAccount, webauthn_enabled: false });

    renderWithToast(<AccountPage />);
    await waitFor(() => {
      expect(screen.getByText("Passkey")).toBeTruthy();
    });
    expect(screen.queryAllByRole("button", { name: "Add" })).toHaveLength(0);
    expect(
      screen.getByText(
        "Passkeys and security keys are turned off for this instance. Ask an administrator to enable them.",
      ),
    ).toBeTruthy();
  });

  it("keeps Manage available for an already-registered passkey even when webauthn is disabled for the instance", async () => {
    mockLoadedAccount({
      ...baseAccount,
      webauthn_enabled: false,
      mfa_methods: [makeWebauthnMethod()],
    });

    renderWithToast(<AccountPage />);
    await waitFor(() => {
      expect(within(passkeyRow()).getByRole("button", { name: "Manage" })).toBeTruthy();
    });
    // Add is still gone - only removal/inspection of what's already registered stays available.
    expect(screen.queryAllByRole("button", { name: "Add" })).toHaveLength(0);
  });

  it("hides Add passkey/Add security key when the account has no local password", async () => {
    mockFetchAccount.mockResolvedValue({ ...baseAccount, has_local_password: false, webauthn_enabled: true, roles: [] });
    mockFetchSessions.mockResolvedValue({ sessions: [] });

    renderWithToast(<AccountPage />);
    await waitFor(() => {
      expect(screen.getByText(/Two-factor setup requires a local password/i)).toBeTruthy();
    });
    expect(screen.queryAllByRole("button", { name: "Add" })).toHaveLength(0);
    // The has_local_password note already covers the webauthn_enabled:false gate too - it
    // must not also show its own separate note (decision 5).
    expect(
      screen.queryByText("Passkeys and security keys are turned off for this instance. Ask an administrator to enable them."),
    ).toBeNull();
  });
});

describe("AccountPage: Manage authenticator app (TOTP) dialog", () => {
  it("Remove removes only TOTP, leaving other methods untouched, and does not open the reset flow", async () => {
    const account: AccountDto = {
      ...baseAccount,
      mfa_methods: [
        { type: "totp", confirmed: true, last_used_at: null },
        makeWebauthnMethod(),
      ],
    };
    mockFetchAccount
      .mockResolvedValueOnce(account)
      .mockResolvedValueOnce({ ...account, mfa_methods: [account.mfa_methods[1]!] });
    mockFetchSessions.mockResolvedValue({ sessions: [] });
    mockDeleteAccountTotp.mockResolvedValueOnce({ ok: true });

    renderWithToast(<AccountPage />);
    await waitFor(() => {
      expect(within(totpRow()).getByRole("button", { name: "Manage" })).toBeTruthy();
    });
    fireEvent.click(within(totpRow()).getByRole("button", { name: "Manage" }));
    const dialog = await screen.findByRole("dialog", { name: "Manage authenticator app" });
    // Another confirmed method remains (the passkey), so no last-method warning here.
    expect(within(dialog).queryByText(/This is your last two-factor method/)).toBeNull();

    fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }));

    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(/Authenticator app removed\./);
    });
    expect(mockDeleteAccountTotp).toHaveBeenCalledWith(undefined);
    expect(mockResetMfa).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows the last-method warning and still removes when TOTP is the account's only confirmed method", async () => {
    mockFetchAccount
      .mockResolvedValueOnce(totpEnrolledAccount)
      .mockResolvedValueOnce(baseAccount);
    mockFetchSessions.mockResolvedValue({ sessions: [] });
    mockDeleteAccountTotp.mockResolvedValueOnce({ ok: true });

    renderWithToast(<AccountPage />);
    await waitFor(() => {
      expect(within(totpRow()).getByRole("button", { name: "Manage" })).toBeTruthy();
    });
    fireEvent.click(within(totpRow()).getByRole("button", { name: "Manage" }));
    const dialog = await screen.findByRole("dialog", { name: "Manage authenticator app" });
    expect(
      within(dialog).getByText(
        "This is your last two-factor method. You will need to set one up again the next time you sign in.",
      ),
    ).toBeTruthy();

    fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }));

    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(/Authenticator app removed\./);
    });
    expect(mockDeleteAccountTotp).toHaveBeenCalledWith(undefined);
  });

  it("reveals the step-up code field on totp_required and submits it with Remove", async () => {
    const { ApiError } = await import("../../src/api/client.js");
    mockFetchAccount
      .mockResolvedValueOnce(totpEnrolledAccount)
      .mockResolvedValueOnce(baseAccount);
    mockFetchSessions.mockResolvedValue({ sessions: [] });
    mockDeleteAccountTotp
      .mockRejectedValueOnce(new ApiError(400, "totp_required", "totp_required"))
      .mockResolvedValueOnce({ ok: true });

    renderWithToast(<AccountPage />);
    await waitFor(() => {
      expect(within(totpRow()).getByRole("button", { name: "Manage" })).toBeTruthy();
    });
    fireEvent.click(within(totpRow()).getByRole("button", { name: "Manage" }));
    const dialog = await screen.findByRole("dialog", { name: "Manage authenticator app" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }));

    await waitFor(() => {
      expect(within(dialog).getByLabelText("Authenticator or backup code")).toBeTruthy();
    });
    expect(within(dialog).getByRole("button", { name: "Remove" }).hasAttribute("disabled")).toBe(true);

    fireEvent.change(within(dialog).getByLabelText("Authenticator or backup code"), {
      target: { value: "123456" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(mockDeleteAccountTotp).toHaveBeenLastCalledWith({ code: "123456" });
  });

  it("refreshes the backup codes status after removing TOTP with a step-up code", async () => {
    const { ApiError } = await import("../../src/api/client.js");
    mockFetchAccount
      .mockResolvedValueOnce(totpEnrolledAccount)
      .mockResolvedValueOnce(baseAccount);
    mockFetchSessions.mockResolvedValue({ sessions: [] });
    mockFetchBackupCodesStatus
      .mockResolvedValueOnce({ total: 10, remaining: 10 })
      .mockResolvedValueOnce({ total: 10, remaining: 9 });
    mockDeleteAccountTotp
      .mockRejectedValueOnce(new ApiError(400, "totp_required", "totp_required"))
      .mockResolvedValueOnce({ ok: true });

    renderWithToast(<AccountPage />);
    await waitFor(() => {
      expect(within(totpRow()).getByRole("button", { name: "Manage" })).toBeTruthy();
    });
    fireEvent.click(within(totpRow()).getByRole("button", { name: "Manage" }));
    const dialog = await screen.findByRole("dialog", { name: "Manage authenticator app" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }));
    await waitFor(() => {
      expect(within(dialog).getByLabelText("Authenticator or backup code")).toBeTruthy();
    });
    fireEvent.change(within(dialog).getByLabelText("Authenticator or backup code"), {
      target: { value: "a-backup-code" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }));

    await waitFor(() => {
      expect(mockFetchBackupCodesStatus).toHaveBeenCalledTimes(2);
    });
  });

  it("shows an inline error for a non-step-up removal failure", async () => {
    mockFetchAccount.mockResolvedValue(totpEnrolledAccount);
    mockFetchSessions.mockResolvedValue({ sessions: [] });
    mockDeleteAccountTotp.mockRejectedValueOnce(new Error("network down"));

    renderWithToast(<AccountPage />);
    await waitFor(() => {
      expect(within(totpRow()).getByRole("button", { name: "Manage" })).toBeTruthy();
    });
    fireEvent.click(within(totpRow()).getByRole("button", { name: "Manage" }));
    const dialog = await screen.findByRole("dialog", { name: "Manage authenticator app" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }));

    await waitFor(() => {
      expect(within(dialog).getByText("Failed to remove authenticator app.")).toBeTruthy();
    });
  });

  it("Reset everything opens the full reset dialog, unchanged, and performs a full wipe", async () => {
    mockFetchAccount
      .mockResolvedValueOnce(totpEnrolledAccount)
      .mockResolvedValueOnce(baseAccount);
    mockFetchSessions.mockResolvedValue({ sessions: [] });
    mockResetMfa.mockResolvedValueOnce({ sessions_revoked: 0 });

    renderWithToast(<AccountPage />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Two-factor authentication options" })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Two-factor authentication options" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /^Reset everything/ }));

    const resetDialog = await screen.findByRole("dialog", { name: "Reset two-factor authentication" });
    expect(resetDialog.textContent).toMatch(
      /removes your authenticator app, passkeys, security keys, and all backup codes/,
    );
    fireEvent.change(
      within(resetDialog).getByLabelText("Current password", { selector: "#account-reset-password" }),
      { target: { value: "current-password" } },
    );
    fireEvent.click(within(resetDialog).getByRole("button", { name: "Reset" }));

    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(/Two-factor authentication reset\./);
    });
    expect(mockResetMfa).toHaveBeenCalledWith({ password: "current-password", code: undefined });
    // The "Reset everything" path goes through the unmodified reset flow, not the new
    // TOTP-only removal endpoint.
    expect(mockDeleteAccountTotp).not.toHaveBeenCalled();
  });

  it("clicking outside the Reset dialog while resetting does not dismiss it", async () => {
    mockFetchAccount.mockResolvedValue(totpEnrolledAccount);
    mockFetchSessions.mockResolvedValue({ sessions: [] });
    mockResetMfa.mockImplementationOnce(() => new Promise(() => {}));

    renderWithToast(<AccountPage />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Two-factor authentication options" })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Two-factor authentication options" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /^Reset everything/ }));
    const resetDialog = await screen.findByRole("dialog", { name: "Reset two-factor authentication" });
    fireEvent.change(
      within(resetDialog).getByLabelText("Current password", { selector: "#account-reset-password" }),
      { target: { value: "current-password" } },
    );
    fireEvent.click(within(resetDialog).getByRole("button", { name: "Reset" }));
    await waitFor(() => {
      expect(within(resetDialog).getByRole("button", { name: "Cancel" }).hasAttribute("disabled")).toBe(true);
    });

    fireEvent.click(document.querySelector(".at-modal-backdrop")!);

    expect(screen.getByRole("dialog", { name: "Reset two-factor authentication" })).toBeTruthy();
  });

  it("Close dismisses the manage dialog without removing TOTP or opening the reset flow", async () => {
    mockFetchAccount.mockResolvedValue(totpEnrolledAccount);
    mockFetchSessions.mockResolvedValue({ sessions: [] });

    renderWithToast(<AccountPage />);
    await waitFor(() => {
      expect(within(totpRow()).getByRole("button", { name: "Manage" })).toBeTruthy();
    });
    fireEvent.click(within(totpRow()).getByRole("button", { name: "Manage" }));
    const dialog = await screen.findByRole("dialog", { name: "Manage authenticator app" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(mockDeleteAccountTotp).not.toHaveBeenCalled();
    expect(mockResetMfa).not.toHaveBeenCalled();
  });

  it("clicking outside the dialog while a removal is in flight does not dismiss it", async () => {
    mockFetchAccount.mockResolvedValue(totpEnrolledAccount);
    mockFetchSessions.mockResolvedValue({ sessions: [] });
    mockDeleteAccountTotp.mockImplementationOnce(() => new Promise(() => {}));

    renderWithToast(<AccountPage />);
    await waitFor(() => {
      expect(within(totpRow()).getByRole("button", { name: "Manage" })).toBeTruthy();
    });
    fireEvent.click(within(totpRow()).getByRole("button", { name: "Manage" }));
    const dialog = await screen.findByRole("dialog", { name: "Manage authenticator app" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }));
    await waitFor(() => {
      expect(within(dialog).getByRole("button", { name: "Close" }).hasAttribute("disabled")).toBe(true);
    });

    // The backdrop's click-outside-to-close bypasses the (now-disabled) Close button, so this
    // is the only way left to reach onCancel's own loading guard.
    fireEvent.click(document.querySelector(".at-modal-backdrop")!);

    expect(screen.getByRole("dialog", { name: "Manage authenticator app" })).toBeTruthy();
  });
});

describe("AccountPage: Backup codes", () => {
  it("is not shown when the account has no confirmed MFA method yet", async () => {
    mockLoadedAccount(baseAccount);

    renderWithToast(<AccountPage />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Set up" })).toBeTruthy();
    });
    expect(screen.queryByText("Backup codes")).toBeNull();
  });

  it("leaves the row blank rather than crashing the page when the status fetch fails", async () => {
    mockFetchAccount.mockResolvedValue(totpEnrolledAccount);
    mockFetchSessions.mockResolvedValue({ sessions: [] });
    mockFetchBackupCodesStatus.mockRejectedValueOnce(new Error("network down"));

    renderWithToast(<AccountPage />);
    await waitFor(() => {
      expect(mockFetchBackupCodesStatus).toHaveBeenCalledTimes(1);
    });
    // The catch is a silent no-op (no error state to assert on) - flush the rejected promise's
    // microtask queue so the catch itself has actually run before this test (and its coverage
    // snapshot) completes, rather than "Loading..." being trivially true from the initial render.
    await act(async () => {
      await Promise.resolve();
    });
    expect(within(backupCodesRow()).getByText("Loading…")).toBeTruthy();
  });

  it("redirects to login when the status fetch fails with a 401", async () => {
    const { ApiError } = await import("../../src/api/client.js");
    vi.stubGlobal("location", { ...window.location, assign: vi.fn() });
    mockFetchAccount.mockResolvedValue(totpEnrolledAccount);
    mockFetchSessions.mockResolvedValue({ sessions: [] });
    mockFetchBackupCodesStatus.mockRejectedValueOnce(new ApiError(401, "unauthorized", "unauthorized"));

    renderWithToast(<AccountPage />);

    await waitFor(() => {
      expect(window.location.assign).toHaveBeenCalledWith(expect.stringContaining("/login?next="));
    });
  });

  it("does nothing (no crash, no state update) when the status fetch settles after unmount", async () => {
    mockFetchAccount.mockResolvedValue(totpEnrolledAccount);
    mockFetchSessions.mockResolvedValue({ sessions: [] });
    let rejectStatus!: (err: unknown) => void;
    mockFetchBackupCodesStatus.mockImplementationOnce(
      () => new Promise((_, reject) => { rejectStatus = reject; }),
    );

    const { unmount } = renderWithToast(<AccountPage />);
    await waitFor(() => {
      expect(mockFetchBackupCodesStatus).toHaveBeenCalledTimes(1);
    });
    unmount();
    await act(async () => {
      rejectStatus(new Error("network down"));
      await Promise.resolve();
    });
  });

  it("renders the remaining/total status once loaded", async () => {
    mockFetchAccount.mockResolvedValue(totpEnrolledAccount);
    mockFetchSessions.mockResolvedValue({ sessions: [] });
    mockFetchBackupCodesStatus.mockResolvedValueOnce({ total: 10, remaining: 7 });

    renderWithToast(<AccountPage />);
    await waitFor(() => {
      expect(within(backupCodesRow()).getByText("7 of 10 remaining")).toBeTruthy();
    });
  });

  it("renders 'None generated yet' when the batch is empty", async () => {
    mockFetchAccount.mockResolvedValue(totpEnrolledAccount);
    mockFetchSessions.mockResolvedValue({ sessions: [] });
    mockFetchBackupCodesStatus.mockResolvedValueOnce({ total: 0, remaining: 0 });

    renderWithToast(<AccountPage />);
    await waitFor(() => {
      expect(within(backupCodesRow()).getByText("None generated yet")).toBeTruthy();
    });
  });

  it("opens the Manage dialog showing the current status", async () => {
    mockFetchAccount.mockResolvedValue(totpEnrolledAccount);
    mockFetchSessions.mockResolvedValue({ sessions: [] });
    mockFetchBackupCodesStatus.mockResolvedValueOnce({ total: 10, remaining: 3 });

    renderWithToast(<AccountPage />);
    await waitFor(() => {
      expect(within(backupCodesRow()).getByText("3 of 10 remaining")).toBeTruthy();
    });
    fireEvent.click(within(backupCodesRow()).getByRole("button", { name: "Manage" }));
    const dialog = await screen.findByRole("dialog", { name: "Manage backup codes" });
    expect(within(dialog).getByText(/3 of 10 backup codes remaining/)).toBeTruthy();
  });

  it("regenerates and shows the new plaintext codes with a download button, disabling further regeneration", async () => {
    mockFetchAccount.mockResolvedValue(totpEnrolledAccount);
    mockFetchSessions.mockResolvedValue({ sessions: [] });
    mockFetchBackupCodesStatus.mockResolvedValueOnce({ total: 10, remaining: 3 });
    const newCodes = Array.from({ length: BACKUP_RECOVERY_CODE_COUNT }, (_, i) => `NEW-CODE-${i}`);
    mockRegenerateBackupCodes.mockResolvedValueOnce({ ok: true, codes: newCodes });

    renderWithToast(<AccountPage />);
    await waitFor(() => {
      expect(within(backupCodesRow()).getByText("3 of 10 remaining")).toBeTruthy();
    });
    fireEvent.click(within(backupCodesRow()).getByRole("button", { name: "Manage" }));
    const dialog = await screen.findByRole("dialog", { name: "Manage backup codes" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Regenerate" }));

    await waitFor(() => {
      expect(within(dialog).getByText(`Backup codes: save all ${newCodes.length}, shown once`)).toBeTruthy();
    });
    expect(within(dialog).getByRole("button", { name: "Download" })).toBeTruthy();
    expect(mockRegenerateBackupCodes).toHaveBeenCalledWith(undefined);
    // A second click in the same dialog session can't invalidate the batch just shown.
    expect(within(dialog).getByRole("button", { name: "Regenerate" }).hasAttribute("disabled")).toBe(true);
  });

  it("requires a step-up code for regeneration on an MFA-required account, and submits it", async () => {
    const { ApiError } = await import("../../src/api/client.js");
    mockFetchAccount.mockResolvedValue(totpEnrolledAccount);
    mockFetchSessions.mockResolvedValue({ sessions: [] });
    mockFetchBackupCodesStatus.mockResolvedValueOnce({ total: 10, remaining: 10 });
    const newCodes = Array.from({ length: BACKUP_RECOVERY_CODE_COUNT }, (_, i) => `NEW-CODE-${i}`);
    mockRegenerateBackupCodes
      .mockRejectedValueOnce(new ApiError(400, "totp_required", "totp_required"))
      .mockResolvedValueOnce({ ok: true, codes: newCodes });

    renderWithToast(<AccountPage />);
    await waitFor(() => {
      expect(within(backupCodesRow()).getByText("10 of 10 remaining")).toBeTruthy();
    });
    fireEvent.click(within(backupCodesRow()).getByRole("button", { name: "Manage" }));
    const dialog = await screen.findByRole("dialog", { name: "Manage backup codes" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Regenerate" }));

    await waitFor(() => {
      expect(within(dialog).getByLabelText("Authenticator or backup code")).toBeTruthy();
    });
    expect(within(dialog).getByRole("button", { name: "Regenerate" }).hasAttribute("disabled")).toBe(true);

    fireEvent.change(within(dialog).getByLabelText("Authenticator or backup code"), {
      target: { value: "123456" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Regenerate" }));

    await waitFor(() => {
      expect(within(dialog).getByText(`Backup codes: save all ${newCodes.length}, shown once`)).toBeTruthy();
    });
    expect(mockRegenerateBackupCodes).toHaveBeenLastCalledWith({ code: "123456" });
  });

  it("Close dismisses the manage dialog without regenerating", async () => {
    mockFetchAccount.mockResolvedValue(totpEnrolledAccount);
    mockFetchSessions.mockResolvedValue({ sessions: [] });
    mockFetchBackupCodesStatus.mockResolvedValueOnce({ total: 10, remaining: 3 });

    renderWithToast(<AccountPage />);
    await waitFor(() => {
      expect(within(backupCodesRow()).getByText("3 of 10 remaining")).toBeTruthy();
    });
    fireEvent.click(within(backupCodesRow()).getByRole("button", { name: "Manage" }));
    const dialog = await screen.findByRole("dialog", { name: "Manage backup codes" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(mockRegenerateBackupCodes).not.toHaveBeenCalled();
  });

  it("shows an inline error for a non-step-up regeneration failure", async () => {
    mockFetchAccount.mockResolvedValue(totpEnrolledAccount);
    mockFetchSessions.mockResolvedValue({ sessions: [] });
    mockFetchBackupCodesStatus.mockResolvedValueOnce({ total: 10, remaining: 3 });
    mockRegenerateBackupCodes.mockRejectedValueOnce(new Error("network down"));

    renderWithToast(<AccountPage />);
    await waitFor(() => {
      expect(within(backupCodesRow()).getByText("3 of 10 remaining")).toBeTruthy();
    });
    fireEvent.click(within(backupCodesRow()).getByRole("button", { name: "Manage" }));
    const dialog = await screen.findByRole("dialog", { name: "Manage backup codes" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Regenerate" }));

    await waitFor(() => {
      expect(within(dialog).getByText("Failed to regenerate backup codes.")).toBeTruthy();
    });
  });

  it("clicking outside the dialog while regenerating does not dismiss it", async () => {
    mockFetchAccount.mockResolvedValue(totpEnrolledAccount);
    mockFetchSessions.mockResolvedValue({ sessions: [] });
    mockFetchBackupCodesStatus.mockResolvedValueOnce({ total: 10, remaining: 3 });
    mockRegenerateBackupCodes.mockImplementationOnce(() => new Promise(() => {}));

    renderWithToast(<AccountPage />);
    await waitFor(() => {
      expect(within(backupCodesRow()).getByText("3 of 10 remaining")).toBeTruthy();
    });
    fireEvent.click(within(backupCodesRow()).getByRole("button", { name: "Manage" }));
    const dialog = await screen.findByRole("dialog", { name: "Manage backup codes" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Regenerate" }));
    await waitFor(() => {
      expect(within(dialog).getByRole("button", { name: "Close" }).hasAttribute("disabled")).toBe(true);
    });

    fireEvent.click(document.querySelector(".at-modal-backdrop")!);

    expect(screen.getByRole("dialog", { name: "Manage backup codes" })).toBeTruthy();
  });
});
