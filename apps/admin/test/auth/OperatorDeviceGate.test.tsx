// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OperatorDeviceGate } from "../../src/auth/OperatorDeviceGate.js";

const refresh = vi.fn(async () => {});
let deviceLabel: string | null = null;

vi.mock("../../src/auth/AuthProvider.js", () => ({
  useAuth: () => ({ user: { id: "u1" }, deviceLabel, refresh }),
}));

vi.mock("../../src/pages/DeviceLabelStep.js", () => ({
  DeviceLabelStep: ({ onSaved, onSkip }: { onSaved: () => Promise<void>; onSkip: () => void }) => (
    <div>
      <p>label step</p>
      <button type="button" onClick={() => void onSaved()}>
        save label
      </button>
      <button type="button" onClick={onSkip}>
        skip label
      </button>
    </div>
  ),
}));

function renderGate() {
  return render(
    <MemoryRouter initialEntries={["/operator"]}>
      <Routes>
        <Route path="/operator" element={<OperatorDeviceGate />}>
          <Route index element={<p>check-in home</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  deviceLabel = null;
  refresh.mockClear();
  sessionStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe("OperatorDeviceGate", () => {
  it("asks for the device label first when the session has none", () => {
    renderGate();
    expect(screen.getByText("label step")).toBeTruthy();
    expect(screen.queryByText("check-in home")).toBeNull();
  });

  it("goes straight to check-in once the session has a label", () => {
    deviceLabel = "Front desk tablet";
    renderGate();
    expect(screen.getByText("check-in home")).toBeTruthy();
  });

  it("remembers a skip for this session and lets the operator in", () => {
    renderGate();
    fireEvent.click(screen.getByRole("button", { name: "skip label" }));
    expect(screen.getByText("check-in home")).toBeTruthy();
    expect(sessionStorage.getItem("admitto_skip_device_label_u1")).toBe("1");
  });

  it("does not ask again after a skip in the same session", () => {
    sessionStorage.setItem("admitto_skip_device_label_u1", "1");
    renderGate();
    expect(screen.getByText("check-in home")).toBeTruthy();
  });

  it("refreshes the session after the label is saved", async () => {
    renderGate();
    fireEvent.click(screen.getByRole("button", { name: "save label" }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(sessionStorage.getItem("admitto_skip_device_label_u1")).toBeNull();
  });
});
