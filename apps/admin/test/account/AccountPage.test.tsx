// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
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

const REVOKE_SESSION_BUTTON = /Revoke session for admin@example.com/;

const baseAccount: AccountDto = {
  id: "usr-1",
  email: "admin@example.com",
  display_name: "Admin",
  preferred_locale: "en-GB",
  is_active: true,
  must_change_password: false,
  has_local_password: true,
  phone_country_code: null,
  phone_number: null,
  roles: [],
  mfa_methods: [],
  external_identities: [],
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
    country: { kind: "unknown" },
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
  vi.useRealTimers();
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

  it("selecting System default clears the locale to null and updates the example date", async () => {
    mockLoadedAccount();
    renderWithToast(<AccountPage />);
    const select = (await screen.findByLabelText("Regional format")) as HTMLSelectElement;
    expect(select.value).toBe("en-GB");

    fireEvent.change(select, { target: { value: "" } });

    expect(select.value).toBe("");
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
    expect(screen.getByRole("button", { name: "Confirm setup" }).hasAttribute("disabled")).toBe(true);

    fireEvent.click(screen.getByLabelText("I've saved my backup codes"));
    expect(screen.getByRole("button", { name: "Confirm setup" }).hasAttribute("disabled")).toBe(false);
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
      expect(screen.getByRole("button", { name: "Reset" })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    fireEvent.change(screen.getByLabelText("Current password", { selector: "#account-reset-password" }), {
      target: { value: "current-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Reset 2FA" }));

    const dialog = await screen.findByRole("dialog");
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
      expect(screen.getByText("Backup codes: save all 10, shown once")).toBeTruthy();
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
      expect(screen.getByRole("button", { name: "Reset" })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    fireEvent.change(screen.getByLabelText("Current password", { selector: "#account-reset-password" }), {
      target: { value: "current-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Reset 2FA" }));
    const dialog = await screen.findByRole("dialog");
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
      expect(screen.getByRole("button", { name: "Reset" })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    fireEvent.change(screen.getByLabelText("Current password", { selector: "#account-reset-password" }), {
      target: { value: "current-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Reset 2FA" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Reset" }));

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
    fireEvent.click(within(dialog).getByRole("button", { name: "Reset" }));
    await waitFor(() => {
      expect(screen.getByLabelText("Authenticator or backup code")).toBeTruthy();
    });
    expect(screen.getByRole("button", { name: "Reset 2FA" }).hasAttribute("disabled")).toBe(true);

    fireEvent.change(screen.getByLabelText("Authenticator or backup code"), {
      target: { value: "123456" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Reset 2FA" }));
    dialog = await screen.findByRole("dialog");
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
      expect(screen.getByRole("button", { name: "Reset" })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    fireEvent.change(screen.getByLabelText("Current password", { selector: "#account-reset-password" }), {
      target: { value: "current-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Reset 2FA" }));

    let dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Reset" }));
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

describe("AccountPage profile: phone number", () => {
  it("pre-fills the country code and number from the account, and saves changes to both", async () => {
    mockLoadedAccount({ ...baseAccount, phone_country_code: "+48", phone_number: "500100200" });
    mockPatchProfile.mockResolvedValueOnce({
      display_name: baseAccount.display_name,
      preferred_locale: baseAccount.preferred_locale,
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
      expect(screen.getByLabelText("Regional format")).toBeTruthy();
    });
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
