// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cancelMfaEnroll,
  patchAccountProfile,
  beginWebauthnRegistration,
  finishWebauthnRegistration,
  fetchWebauthnCredentials,
  deleteWebauthnCredential,
  deleteAccountTotp,
  fetchBackupCodesStatus,
  regenerateBackupCodes,
} from "../../src/api/client.js";

describe("account API client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("patchAccountProfile PATCHes the profile endpoint and returns the updated fields", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        display_name: "New Name",
        preferred_locale: "en-GB",
        preferred_time_format: "24h",
        phone_country_code: "+48",
        phone_number: "600123456",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await patchAccountProfile({
      display_name: "New Name",
      phone_country_code: "+48",
      phone_number: "600123456",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/account/profile",
      expect.objectContaining({ method: "PATCH", credentials: "same-origin" }),
    );
    expect(result).toEqual({
      display_name: "New Name",
      preferred_locale: "en-GB",
      preferred_time_format: "24h",
      phone_country_code: "+48",
      phone_number: "600123456",
    });
  });

  it("cancelMfaEnroll DELETEs the pending TOTP enrollment endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });
    vi.stubGlobal("fetch", fetchMock);

    await cancelMfaEnroll();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/account/mfa/totp/enroll",
      expect.objectContaining({
        method: "DELETE",
        credentials: "same-origin",
      }),
    );
  });

  it("cancelMfaEnroll propagates API errors", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      statusText: "Conflict",
      json: async () => ({ error: "no_pending_enrollment" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(cancelMfaEnroll()).rejects.toMatchObject({ status: 409 });
  });

  it("beginWebauthnRegistration POSTs the attachment and returns ceremony options", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ options: { challenge: "chal-1" } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await beginWebauthnRegistration({ attachment: "platform" });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/account/mfa/webauthn/register/begin",
      expect.objectContaining({ method: "POST", credentials: "same-origin" }),
    );
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({ attachment: "platform" });
    expect(result).toEqual({ options: { challenge: "chal-1" } });
  });

  it("finishWebauthnRegistration POSTs the ceremony response and returns the new credential's id and backup codes", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, id: "cred-1", backupCodes: ["a1b2", "c3d4"] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await finishWebauthnRegistration({
      attachment: "cross-platform",
      label: "YubiKey",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      response: { id: "cred-1" } as any,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/account/mfa/webauthn/register/finish",
      expect.objectContaining({ method: "POST", credentials: "same-origin" }),
    );
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(init.body))).toMatchObject({ attachment: "cross-platform", label: "YubiKey" });
    expect(result).toEqual({ ok: true, id: "cred-1", backupCodes: ["a1b2", "c3d4"] });
  });

  it("fetchWebauthnCredentials GETs the registered credentials", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        credentials: [{ id: "cred-1", label: "Passkey", attachment: "platform", confirmedAt: null, lastUsedAt: null }],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchWebauthnCredentials();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/account/mfa/webauthn",
      expect.objectContaining({ credentials: "same-origin" }),
    );
    expect(result.credentials).toHaveLength(1);
  });

  it("deleteWebauthnCredential DELETEs the encoded credential endpoint with an optional step-up code", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetchMock);

    await deleteWebauthnCredential("cred with space", { code: "123456" });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/account/mfa/webauthn/cred%20with%20space",
      expect.objectContaining({ method: "DELETE", credentials: "same-origin" }),
    );
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({ code: "123456" });

    await deleteWebauthnCredential("cred-2");
    const init2 = fetchMock.mock.calls[1]![1] as RequestInit;
    expect(init2.body).toBeUndefined();
  });

  it("deleteAccountTotp DELETEs the TOTP endpoint with no body when no code is given, or with a code otherwise", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetchMock);

    await deleteAccountTotp();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/account/mfa/totp",
      expect.objectContaining({ method: "DELETE", credentials: "same-origin" }),
    );
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.body).toBeUndefined();

    await deleteAccountTotp({ code: "123456" });
    const init2 = fetchMock.mock.calls[1]![1] as RequestInit;
    expect(JSON.parse(String(init2.body))).toEqual({ code: "123456" });
  });

  it("fetchBackupCodesStatus GETs the remaining/total status", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ total: 10, remaining: 7 }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchBackupCodesStatus();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/account/mfa/backup-codes",
      expect.objectContaining({ credentials: "same-origin" }),
    );
    expect(result).toEqual({ total: 10, remaining: 7 });
  });

  it("regenerateBackupCodes POSTs the regenerate endpoint and returns the fresh plaintext batch", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, codes: ["code-1", "code-2"] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await regenerateBackupCodes();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/account/mfa/backup-codes/regenerate",
      expect.objectContaining({ method: "POST", credentials: "same-origin" }),
    );
    expect(result).toEqual({ ok: true, codes: ["code-1", "code-2"] });
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({});

    await regenerateBackupCodes({ code: "123456" });
    const init2 = fetchMock.mock.calls[1]![1] as RequestInit;
    expect(JSON.parse(String(init2.body))).toEqual({ code: "123456" });
  });
});
