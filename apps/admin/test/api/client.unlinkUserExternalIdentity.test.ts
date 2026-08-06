// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { unlinkUserExternalIdentity } from "../../src/api/client.js";

describe("unlinkUserExternalIdentity (client)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends a DELETE with a JSON body and Content-Type header", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await unlinkUserExternalIdentity("usr-1", { new_password: "long-enough-password" });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/admin/users/usr-1/external-identity");
    expect(init).toMatchObject({
      method: "DELETE",
      credentials: "same-origin",
      body: JSON.stringify({ new_password: "long-enough-password" }),
    });
    expect(init.headers["Content-Type"]).toBe("application/json");
  });
});
