import { describe, expect, it, vi } from "vitest";
import { refetchCardProps } from "../../src/utils/refetch-card.js";

type Handler = (event: { preventDefault: () => void; stopPropagation: () => void }) => void;

describe("refetchCardProps", () => {
  it("is nothing while the card is neither refreshing nor still showing the bar", () => {
    expect(refetchCardProps(false, false)).toEqual({});
  });

  it("keeps the box the bar is positioned in, and the dimming, for the tail after the refresh ends, but blocks nothing then", () => {
    const props = refetchCardProps(false, true, true) as Record<string, unknown>;
    expect(props.className).toBe("refetch-card refetch-card--dim");
    expect(props).not.toHaveProperty("aria-busy");
    expect(props).not.toHaveProperty("inert");
    expect(props).not.toHaveProperty("onClickCapture");
  });

  it("marks a refreshing card busy and makes it inert by default (its actions open their dialog elsewhere)", () => {
    const props = refetchCardProps(true, false) as Record<string, unknown>;
    expect(props.className).toBe("refetch-card refetch-card--busy");
    expect(props["aria-busy"]).toBe(true);
    expect(props.inert).toBe(true);
    expect(props).not.toHaveProperty("onClickCapture");
  });

  it("with keepFocus the card is not inert, and every click and submit is swallowed before a control in it sees it", () => {
    const props = refetchCardProps(true, true, true) as Record<string, unknown>;
    expect(props.className).toBe("refetch-card refetch-card--busy refetch-card--dim");
    expect(props).not.toHaveProperty("inert");
    for (const key of ["onClickCapture", "onSubmitCapture"]) {
      const event = { preventDefault: vi.fn(), stopPropagation: vi.fn() };
      (props[key] as Handler)(event);
      expect(event.preventDefault).toHaveBeenCalledTimes(1);
      expect(event.stopPropagation).toHaveBeenCalledTimes(1);
    }
  });
});
