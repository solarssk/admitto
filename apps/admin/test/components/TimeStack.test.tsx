// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ActorOrViewerLocalTimeLine } from "../../src/components/ActorOrViewerLocalTimeLine.js";
import { LocalTimeLine, TimeStack } from "../../src/components/TimeStack.js";
import * as eventDates from "../../src/utils/event-dates.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("TimeStack", () => {
  it("draws the primary time on top and the lines that are passed under it, in the shared classes", () => {
    const { container } = render(
      <TimeStack primary="2026-11-25 14:50:00 UTC">
        <LocalTimeLine title="User's local time">15:50 (Europe/Warsaw, UTC+1)</LocalTimeLine>
      </TimeStack>,
    );

    const stack = container.querySelector(".time-stack");
    expect(stack).toBeTruthy();
    expect(stack!.children[0]!.className).toBe("time-stack__utc");
    expect(stack!.children[0]!.textContent).toBe("2026-11-25 14:50:00 UTC");
    expect(stack!.children[1]!.className).toBe("time-stack__local");
  });

  it("needs no secondary line", () => {
    const { container } = render(<TimeStack primary="2026-11-25 14:50:00 UTC" />);
    expect(container.querySelector(".time-stack")!.children).toHaveLength(1);
  });
});

describe("LocalTimeLine", () => {
  it("has one icon with the title as its tooltip, and the title for a screen reader before the time", () => {
    const { container } = render(<LocalTimeLine title="Sender's local time">15:50 (Europe/Warsaw, UTC+1)</LocalTimeLine>);

    const icon = container.querySelector("i.ti.ti-user");
    expect(icon?.getAttribute("title")).toBe("Sender's local time");
    expect(icon?.getAttribute("aria-hidden")).toBe("true");
    expect(container.querySelector(".sr-only")?.textContent).toBe("Sender's local time: ");
    expect(container.querySelector(".time-stack__local")?.textContent).toBe("Sender's local time: 15:50 (Europe/Warsaw, UTC+1)");
  });
});

describe("ActorOrViewerLocalTimeLine", () => {
  it("shows the time in the zone that was stored, with the title it is given", () => {
    render(<ActorOrViewerLocalTimeLine iso="2026-11-25T14:50:00.000Z" actorTimezone="Europe/Warsaw" actorTitle="Signer's local time" />);

    // The clock text depends on the locale (15:50 or 3:50 PM); the zone it is shown in does not.
    expect(screen.getByText(/Europe\/Warsaw/)).toBeTruthy();
    expect(document.querySelector("i.ti-user")?.getAttribute("title")).toBe("Signer's local time");
  });

  it("falls back to the viewer's zone, labelled Your local time, when no zone was stored", () => {
    vi.spyOn(eventDates, "viewerLocalTime").mockReturnValue("09:50 (America/New_York, UTC-5)");
    render(<ActorOrViewerLocalTimeLine iso="2026-11-25T14:50:00.000Z" actorTimezone={null} />);

    expect(screen.getByText("09:50 (America/New_York, UTC-5)")).toBeTruthy();
    expect(document.querySelector("i.ti-user")?.getAttribute("title")).toBe("Your local time");
  });
});
