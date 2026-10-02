import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { advanceTimers } from "../test-utils.js";
import { LOAD_TIMEOUT_MESSAGE, LOAD_TIMEOUT_MS } from "../../src/utils/loading-timing.js";

/**
 * The first-load behaviour that every settings panel on the loading standard shares, as one set of tests: its placeholder
 * holds the panel's room from the first frame and is drawn after 200ms, says that it is taking longer than usual after 8
 * seconds, and after 30 seconds the panel is an error with a Retry instead of a loader that never stops.
 */
export function describePanelLoading(options: {
  /** The placeholder's accessible name ("Loading organisation settings"). */
  label: string;
  /** The error's title when the first load fails or runs out of time. */
  errorTitle: string;
  /** Renders the panel. */
  render: () => void;
  /** Makes every request of the panel's first load wait until it is abandoned (`hangUntilAborted`). */
  hang: () => void;
}): void {
  describe(`first load of ${options.label}`, () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("holds the placeholder's room from the first frame, draws it after 200ms, and says it is taking longer after 8 seconds", async () => {
      options.hang();
      vi.useFakeTimers();
      options.render();
      await advanceTimers(0);
      const region = () => screen.queryByLabelText(options.label);
      expect(region()?.className).toContain("at-loading-hold");
      await advanceTimers(200);
      expect(region()?.className).not.toContain("at-loading-hold");
      expect(region()?.textContent).not.toContain("Taking longer than usual");
      await advanceTimers(7800);
      expect(region()?.textContent).toContain("Taking longer than usual");
    });

    it("gives up after 30 seconds with an error and a Retry, in the time limit's own words", async () => {
      options.hang();
      vi.useFakeTimers();
      options.render();
      await advanceTimers(LOAD_TIMEOUT_MS);
      await advanceTimers(0);
      expect(screen.getByText(options.errorTitle)).toBeTruthy();
      expect(screen.getByText(LOAD_TIMEOUT_MESSAGE)).toBeTruthy();
      expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
      expect(screen.queryByLabelText(options.label)).toBeNull();
    });
  });
}
