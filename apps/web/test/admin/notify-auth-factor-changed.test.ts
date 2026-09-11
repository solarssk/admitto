import type { PrismaClient } from "@admitto/db";
import { beforeEach, describe, expect, it, vi } from "vitest";

const notify = vi.fn();
vi.mock("@admitto/notifications", () => ({
  notify: (...args: unknown[]) => notify(...args),
}));

const resolveInstanceOrganizationId = vi.fn();
vi.mock("../../src/admin/instance-org.js", () => ({
  resolveInstanceOrganizationId: (...args: unknown[]) => resolveInstanceOrganizationId(...args),
}));

import { notifyAuthFactorChanged } from "../../src/admin/notify-auth-factor-changed.js";

describe("notifyAuthFactorChanged", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("dispatches account.auth_factor.changed targeting the given user, with dedupeKey = userId", async () => {
    resolveInstanceOrganizationId.mockResolvedValue("org-1");
    notify.mockResolvedValue(undefined);

    await notifyAuthFactorChanged({} as PrismaClient, "user-1", "Your password was changed", "body text");

    expect(notify).toHaveBeenCalledWith(
      {},
      "account.auth_factor.changed",
      {
        organizationId: "org-1",
        title: "Your password was changed",
        body: "body text",
        targetUserId: "user-1",
        dedupeKey: "user-1",
      },
    );
  });

  it("never throws when resolving the instance organization fails - logs instead", async () => {
    resolveInstanceOrganizationId.mockRejectedValue(new Error("no organization seeded"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(
      notifyAuthFactorChanged({} as PrismaClient, "user-1", "title", "body"),
    ).resolves.toBeUndefined();

    expect(notify).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("account.notify_auth_factor_changed_failed"),
    );
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("no organization seeded"));
    errorSpy.mockRestore();
  });

  it("never throws when notify() itself rejects - logs instead (defensive: notify() is documented to never throw, but this wrapper doesn't assume it)", async () => {
    resolveInstanceOrganizationId.mockResolvedValue("org-1");
    notify.mockRejectedValue(new Error("unexpected dispatcher failure"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(
      notifyAuthFactorChanged({} as PrismaClient, "user-1", "title", "body"),
    ).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("unexpected dispatcher failure"));
    errorSpy.mockRestore();
  });

  it("logs a non-Error rejection as its stringified form, not 'undefined'", async () => {
    resolveInstanceOrganizationId.mockRejectedValue("plain string failure");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await notifyAuthFactorChanged({} as PrismaClient, "user-1", "title", "body");

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("plain string failure"));
    errorSpy.mockRestore();
  });
});
