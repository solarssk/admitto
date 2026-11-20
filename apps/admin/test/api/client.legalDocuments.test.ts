// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  deleteLegalDocument,
  fetchLegalDocument,
  fetchLegalDocuments,
  publishLegalDocument,
  saveLegalDocument,
  unpublishLegalDocument,
} from "../../src/api/client.js";

function stubFetch(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  const fetchMock = vi.fn().mockResolvedValue({ ok: init.ok ?? true, status: init.status ?? 200, statusText: "", json: async () => body });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("legal text calls (client)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads the list of an event, with the abort signal, and returns the whole answer", async () => {
    const answer = { items: [], missing: [{ ref: "privacy-notice", kind: "privacy_notice", key: null }], limits: { title_chars: 200, content_chars: 100000, consents: 10 } };
    const fetchMock = stubFetch(answer);
    const controller = new AbortController();

    const result = await fetchLegalDocuments("evt one", controller.signal);

    expect(fetchMock).toHaveBeenCalledWith("/api/admin/events/evt%20one/legal-documents", { credentials: "same-origin", signal: controller.signal });
    expect(result).toEqual(answer);
  });

  it("reads one text by its ref, encoded", async () => {
    const fetchMock = stubFetch({ ref: "consent-photo", content_html: "<p>x</p>" });

    await fetchLegalDocument("evt-1", "consent-photo");

    expect(fetchMock).toHaveBeenCalledWith("/api/admin/events/evt-1/legal-documents/consent-photo", { credentials: "same-origin", signal: undefined });
  });

  it("saves a text with PUT and the title and HTML as the body", async () => {
    const fetchMock = stubFetch({ ref: "privacy-notice", content_html: "<p>kept</p>" });

    const saved = await saveLegalDocument("evt-1", "privacy-notice", { title: "Privacy notice", content_html: "<p>sent</p>" });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/admin/events/evt-1/legal-documents/privacy-notice");
    expect(init).toMatchObject({ method: "PUT", credentials: "same-origin" });
    expect(JSON.parse(init.body as string)).toEqual({ title: "Privacy notice", content_html: "<p>sent</p>" });
    expect(saved.content_html).toBe("<p>kept</p>");
  });

  it.each([
    ["publishes", publishLegalDocument, "publish"],
    ["unpublishes", unpublishLegalDocument, "unpublish"],
  ] as const)("%s a text with POST", async (_name, call, segment) => {
    const fetchMock = stubFetch({ ref: "event-terms", published: segment === "publish" });

    await call("evt-1", "event-terms");

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`/api/admin/events/evt-1/legal-documents/event-terms/${segment}`);
    expect(init).toMatchObject({ method: "POST", credentials: "same-origin" });
  });

  it("deletes a text with DELETE", async () => {
    const fetchMock = stubFetch({ ok: true });

    await deleteLegalDocument("evt-1", "consent-photo");

    expect(fetchMock).toHaveBeenCalledWith("/api/admin/events/evt-1/legal-documents/consent-photo", expect.objectContaining({ method: "DELETE" }));
  });

  it("throws an ApiError that carries the status and the machine code of a refusal", async () => {
    stubFetch({ error: "legal_document_in_use" }, { ok: false, status: 409 });

    await expect(unpublishLegalDocument("evt-1", "privacy-notice")).rejects.toMatchObject({ status: 409, code: "legal_document_in_use" });
  });
});
