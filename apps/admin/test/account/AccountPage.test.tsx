// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountPage } from "../../src/account/AccountPage.js";
import type { AccountDto, SessionListDto } from "../../src/api/types.js";
import { PASSWORD_STRENGTH_STRONG } from "@admitto/auth/password-strength-fixtures";
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
  };
});

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
} from "../../src/api/client.js";

const mockDeleteSession = vi.mocked(deleteAccountSession);

const mockFetchAccount = vi.mocked(fetchAccount);
const mockFetchSessions = vi.mocked(fetchAccountSessions);
const mockPatchProfile = vi.mocked(patchAccountProfile);
const mockPatchPassword = vi.mocked(patchAccountPassword);
const mockEnrollMfaTotp = vi.mocked(enrollMfaTotp);
const mockCancelMfaEnroll = vi.mocked(cancelMfaEnroll);
const mockConfirmMfaTotp = vi.mocked(confirmMfaTotp);
const mockResetMfa = vi.mocked(resetMfa);

const baseAccount: AccountDto = {
  id: "usr-1",
  email: "admin@example.com",
  display_name: "Admin",
  preferred_locale: "en-GB",
  is_active: true,
  must_change_password: false,
  has_local_password: true,
  roles: [],
  mfa_methods: [],
};

const totpEnrolledAccount: AccountDto = {
  ...baseAccount,
  mfa_methods: [{ type: "totp", confirmed: true, last_used_at: null }],
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
    userAgent: null,
    loginAt: "2026-01-01T00:00:00.000Z",
    lastSeenAt: "2026-01-01T01:00:00.000Z",
    expiresAt: "2026-01-02T00:00:00.000Z",
    authMethod: "local",
    stage: "active",
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

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AccountPage toasts", () => {
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
      expect(screen.getByLabelText("Regional format")).toBeTruthy();
    });

    fireEvent.change(screen.getByLabelText("Regional format"), { target: { value: "pl-PL" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(/Reload this page/);
    });

    vi.advanceTimersByTime(10_000);
    expect(screen.getByTestId("at-toast").textContent).toMatch(/Reload this page/);
    vi.useRealTimers();
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
    expect(screen.queryByRole("dialog")).toBeTruthy();
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
    expect(screen.getByRole("button", { name: "Confirm setup" }).hasAttribute("disabled")).toBe(true);

    fireEvent.click(screen.getByLabelText("I've saved my backup codes"));
    expect(screen.getByRole("button", { name: "Confirm setup" }).hasAttribute("disabled")).toBe(false);
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
    fireEvent.click(screen.getByRole("button", { name: "Confirm setup" }));

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
    fireEvent.click(screen.getByRole("button", { name: "Confirm setup" }));

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
      expect(screen.getByRole("button", { name: "Reset" })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    fireEvent.change(screen.getByLabelText("Current password", { selector: "#account-reset-password" }), {
      target: { value: "current-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Reset 2FA" }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toMatch(/stay signed in on this device/i);
    fireEvent.click(within(dialog).getByRole("button", { name: "Reset 2FA" }));

    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(
        /Two-factor authentication reset\. 1 other session ended\./,
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
      expect(screen.getByText("Backup codes — save all 10, shown once")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => {
      expect(mockCancelMfaEnroll).toHaveBeenCalled();
      expect(screen.queryByLabelText("Authenticator code")).toBeNull();
    });
  });

  it("closes reset 2FA form on Cancel without calling reset API", async () => {
    mockFetchAccount.mockResolvedValue(totpEnrolledAccount);
    mockFetchSessions.mockResolvedValue({ sessions: [] });

    renderWithToast(<AccountPage />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Reset" })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => {
      expect(screen.queryByLabelText("Current password", { selector: "#account-reset-password" })).toBeNull();
    });
    expect(mockResetMfa).not.toHaveBeenCalled();
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
    fireEvent.click(within(dialog).getByRole("button", { name: "Revoke all" }));

    await waitFor(() => {
      expect(mockDeleteSession).toHaveBeenCalledWith("sess-2");
      expect(screen.queryByRole("dialog")).toBeNull();
    });
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
      expect(screen.getAllByRole("button", { name: "Revoke" }).length).toBeGreaterThan(0);
    });

    const revokeButtons = screen.getAllByRole("button", { name: "Revoke" });
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
      expect(screen.getByRole("button", { name: "Reset" })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    fireEvent.change(screen.getByLabelText("Current password", { selector: "#account-reset-password" }), {
      target: { value: "current-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Reset 2FA" }));

    const dialog = await screen.findByRole("dialog");
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
      expect(screen.getByText(/Failed to load account/)).toBeTruthy();
    });
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
      userAgent: null,
      loginAt: "2026-01-01T00:00:00.000Z",
      lastSeenAt: "2026-01-01T01:00:00.000Z",
      expiresAt: "2026-01-02T00:00:00.000Z",
      authMethod: "local",
      stage: "active",
      isCurrent: false,
    };
    mockLoadedAccount();
    mockFetchSessions.mockResolvedValue({ sessions: [otherSession] });
    mockDeleteSession.mockRejectedValueOnce(new ApiError(500, "secret_internal"));
    renderWithToast(<AccountPage />);
    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: "Revoke" }).length).toBeGreaterThan(0);
    });
    fireEvent.click(screen.getAllByRole("button", { name: "Revoke" })[0]!);
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
      userAgent: null,
      loginAt: "2026-01-01T00:00:00.000Z",
      lastSeenAt: "2026-01-01T01:00:00.000Z",
      expiresAt: "2026-01-02T00:00:00.000Z",
      authMethod: "local",
      stage: "active",
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
    fireEvent.click(within(dialog).getByRole("button", { name: "Revoke all" }));
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
      expect(screen.getByRole("button", { name: "Reset" })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    fireEvent.change(screen.getByLabelText("Current password", { selector: "#account-reset-password" }), {
      target: { value: "current-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Reset 2FA" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Reset 2FA" }));
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
      expect(screen.getByRole("button", { name: "Reset" })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    fireEvent.change(screen.getByLabelText("Current password", { selector: "#account-reset-password" }), {
      target: { value: "current-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Reset 2FA" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Reset 2FA" }));

    // The dialog closes (progressive disclosure reveals the code field instead), so the
    // explanation must reach the user via toast, not the now-unmounted dialog's inline error.
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(screen.getByTestId("at-toast").textContent).toMatch(
        /Enter your authenticator app code to continue\./,
      );
    });
    expect(screen.getByLabelText("Authenticator or backup code")).toBeTruthy();
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
      expect(screen.getByRole("button", { name: "Reset" })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    fireEvent.change(screen.getByLabelText("Current password", { selector: "#account-reset-password" }), {
      target: { value: "current-password" },
    });

    // Reset button stays disabled once the code field appears, until a code is entered.
    fireEvent.click(screen.getByRole("button", { name: "Reset 2FA" }));
    let dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Reset 2FA" }));
    await waitFor(() => {
      expect(screen.getByLabelText("Authenticator or backup code")).toBeTruthy();
    });
    expect(screen.getByRole("button", { name: "Reset 2FA" }).hasAttribute("disabled")).toBe(true);

    fireEvent.change(screen.getByLabelText("Authenticator or backup code"), {
      target: { value: "123456" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Reset 2FA" }));
    dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Reset 2FA" }));

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
      expect(screen.getByRole("button", { name: "Reset" })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    fireEvent.change(screen.getByLabelText("Current password", { selector: "#account-reset-password" }), {
      target: { value: "current-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Reset 2FA" }));

    let dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Reset 2FA" }));
    await waitFor(() => {
      expect(within(dialog).getByText(/Failed to reset 2FA/)).toBeTruthy();
    });

    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    fireEvent.click(screen.getByRole("button", { name: "Reset 2FA" }));
    dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByText(/Failed to reset 2FA/)).toBeNull();
  });
});

describe("AccountPage profile: sign-in method", () => {
  it("shows 'Local password' for accounts with only local password", async () => {
    mockFetchAccount.mockResolvedValue({ ...baseAccount, has_local_password: true, roles: [] });
    mockFetchSessions.mockResolvedValue({ sessions: [] });

    renderWithToast(<AccountPage />);
    await waitFor(() => {
      expect(screen.getByText("Local password")).toBeTruthy();
    });
  });

  it("shows 'Identity provider (SSO)' for accounts without local password", async () => {
    mockFetchAccount.mockResolvedValue({
      ...baseAccount,
      has_local_password: false,
      roles: [{ id: "r1", role: "admin", is_oidc: true }],
    });
    mockFetchSessions.mockResolvedValue({ sessions: [] });

    renderWithToast(<AccountPage />);
    await waitFor(() => {
      expect(screen.getByText("Identity provider (SSO)")).toBeTruthy();
    });
  });

  it("shows 'Local password + Identity provider' when both are present", async () => {
    mockFetchAccount.mockResolvedValue({
      ...baseAccount,
      has_local_password: true,
      roles: [{ id: "r1", role: "admin", is_oidc: true }],
    });
    mockFetchSessions.mockResolvedValue({ sessions: [] });

    renderWithToast(<AccountPage />);
    await waitFor(() => {
      expect(screen.getByText("Local password + Identity provider")).toBeTruthy();
    });
  });

  it("shows 'Regional format' label for locale select", async () => {
    mockFetchAccount.mockResolvedValue(baseAccount);
    mockFetchSessions.mockResolvedValue({ sessions: [] });

    renderWithToast(<AccountPage />);
    await waitFor(() => {
      expect(screen.getByLabelText("Regional format")).toBeTruthy();
    });
  });
});
