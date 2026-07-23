// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CheckInCameraResultPanel } from "../../src/checkin/CheckInCameraResultPanel.js";
import type { CheckInScanResponse } from "../../src/api/types.js";

const validScan: CheckInScanResponse = { status: "VALID", confirmed: true };

afterEach(cleanup);

describe("CheckInCameraResultPanel", () => {
  it("appends the given className to the result element's class list", () => {
    const { container } = render(
      <CheckInCameraResultPanel
        scanResult={validScan}
        card={null}
        pending={false}
        canAct={false}
        eventTimezone="UTC"
        onReset={vi.fn()}
        className="extra-class"
      />,
    );

    expect(container.querySelector(".ck-overlay__result.extra-class")).toBeTruthy();
  });

  it("omits the trailing space when no className is given", () => {
    const { container } = render(
      <CheckInCameraResultPanel
        scanResult={validScan}
        card={null}
        pending={false}
        canAct={false}
        eventTimezone="UTC"
        onReset={vi.fn()}
      />,
    );

    const result = container.querySelector(".ck-overlay__result");
    expect(result?.className.endsWith(" ")).toBe(false);
  });
});
