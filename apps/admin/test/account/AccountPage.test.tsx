// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountPage } from "../../src/account/AccountPage.js";
import type { AccountDto } from "../../src/api/types.js";
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
    confirmMfaTotp: vi.fn(),
    resetMfa: vi.fn(),
    deleteAccountSession: vi.fn(),
  };
});

vi.mock("../../src/account/TotpQrCode.js", () => ({
  TotpQrCode: () => <div data-testid="totp-qr" />,
}));

import {
  fetchAccount,
  fetchAccountSessions,
  patchAccountProfile,
  patchAccountPassword,
  enrollMfaTotp,
  confirmMfaTotp,
  resetMfa,
} from "../../src/api/client.js";

const mockFetchAccount = vi.mocked(fetchAccount);
const mockFetchSessions = vi.mocked(fetchAccountSessions);
const mockPatchProfile = vi.mocked(patchAccountProfile);
const mockPatchPassword = vi.mocked(patchAccountPassword);
const mockEnrollMfaTotp = vi.mocked(enrollMfaTotp);
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

function fillPasswordForm() {
  fireEvent.change(screen.getByLabelText("Current password"), {
    target: { value: "old-password-1" },
  });
  fireEvent.change(screen.getByLabelText("New password"), {
    target: { value: "new-password-12" },
  });
  fireEvent.change(screen.getByLabelText("Confirm new password"), {
    target: { value: "new-password-12" },
  });
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
      expect(screen.getByLabelText("Date format")).toBeTruthy();
    });

    fireEvent.change(screen.getByLabelText("Date format"), { target: { value: "pl-PL" } });
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
      expect(screen.getByLabelText("New password")).toBeTruthy();
    });

    fireEvent.change(screen.getByLabelText("New password"), {
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
      expect(screen.getByLabelText("New password")).toBeTruthy();
    });

    fireEvent.change(screen.getByLabelText("New password"), {
      target: { value: "short" },
    });
    expect(screen.getByText("Too short")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("New password"), {
      target: { value: "Abcdefghijkl12!@#" },
    });
    expect(screen.getByText("Strong")).toBeTruthy();
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
    mockPatchPassword.mockRejectedValueOnce(new ApiError(400, "wrong_password"));

    renderWithToast(<AccountPage />);
    await waitFor(() => {
      expect(screen.getByLabelText("Current password")).toBeTruthy();
    });

    fillPasswordForm();
    fireEvent.click(screen.getByRole("button", { name: "Change password" }));

    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(/wrong_password/);
    });
  });

  it("toasts MFA enrollment errors", async () => {
    mockLoadedAccount();
    const { ApiError } = await import("../../src/api/client.js");
    mockEnrollMfaTotp.mockRejectedValueOnce(new ApiError(400, "mfa_already_enabled"));

    renderWithToast(<AccountPage />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Set up authenticator" })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Set up authenticator" }));

    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(/mfa_already_enabled/);
    });
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
      expect(screen.getByRole("button", { name: "Set up authenticator" })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Set up authenticator" }));
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
    mockConfirmMfaTotp.mockRejectedValueOnce(new ApiError(400, "invalid_code"));

    renderWithToast(<AccountPage />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Set up authenticator" })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Set up authenticator" }));
    await waitFor(() => {
      expect(screen.getByLabelText("Authenticator code")).toBeTruthy();
    });

    fireEvent.change(screen.getByLabelText("Authenticator code"), { target: { value: "000000" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm setup" }));

    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(/invalid_code/);
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
      expect(screen.getByRole("button", { name: "Reset 2FA" })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Reset 2FA" }));
    fireEvent.change(screen.getByLabelText("Current password", { selector: "#account-reset-password" }), {
      target: { value: "current-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Reset 2FA" }));

    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Reset 2FA" }));

    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(
        /Two-factor authentication reset\. 1 other session ended\./,
      );
    });
  });
});
