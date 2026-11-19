// @vitest-environment jsdom
import { cleanup, render, renderHook, screen } from "@testing-library/react";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@admitto/ui";
import type { ReactNode } from "react";
import { LegalTextTable, type LegalRowControls } from "../../src/registration/LegalTextTable.js";
import { textDescription } from "../../src/registration/legalTexts.js";
import { useLegalTextActions } from "../../src/registration/useLegalTextActions.js";
import { legalDoc } from "./legalFixtures.js";

const saveRegistrationSettings = vi.fn();
vi.mock("../../src/api/client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/api/client.js")>()),
  saveRegistrationSettings: (...args: unknown[]) => saveRegistrationSettings(...args),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const controls: LegalRowControls = {
  event: { archived_at: null },
  registrationOn: false,
  pending: null,
  onOpen: vi.fn(),
  onToggleAsked: vi.fn(),
  onPublish: vi.fn(),
  onUnpublish: vi.fn(),
  onDelete: vi.fn(),
};

describe("LegalTextTable: a consent row that has no stored text", () => {
  it("draws the row with a Write button and no switch, instead of failing", () => {
    render(<LegalTextTable rows={[{ target: { ref: "consent-x", kind: "consent", key: "x" }, document: null }]} showAsked controls={controls} />);

    expect(screen.getByRole("button", { name: "Write Extra consent" })).toBeTruthy();
    expect(screen.queryByRole("switch")).toBeNull();
  });
});

describe("textDescription", () => {
  it("says the key of a consent, and nothing odd for one without a key", () => {
    const row = (key: string | null) => ({ target: { ref: "consent-x", kind: "consent" as const, key }, document: legalDoc("consent-x") });

    expect(textDescription(row("x"))).toBe("Key: x");
    expect(textDescription(row(null))).toBe("Key: ");
  });
});

describe("useLegalTextActions", () => {
  const wrapper = ({ children }: { children: ReactNode }) => <ToastProvider>{children}</ToastProvider>;

  it("does nothing when it is told yes and nothing asked", () => {
    const { result } = renderHook(() => useLegalTextActions({ eventId: "evt-1", items: [], reload: vi.fn() }), { wrapper });

    act(() => result.current.answerYes());

    expect(result.current.confirm).toBeNull();
    expect(saveRegistrationSettings).not.toHaveBeenCalled();
  });

  it("writes an empty key for a consent that has none, and does not crash", async () => {
    saveRegistrationSettings.mockResolvedValue({});
    const { result } = renderHook(() => useLegalTextActions({ eventId: "evt-1", items: [], reload: vi.fn().mockResolvedValue(undefined) }), { wrapper });

    await act(async () => result.current.toggleAsked({ target: { ref: "consent-", kind: "consent", key: null }, document: legalDoc("consent-x") }, true));

    expect(saveRegistrationSettings).toHaveBeenCalledWith("evt-1", { consent_keys: [""] });
  });
});
