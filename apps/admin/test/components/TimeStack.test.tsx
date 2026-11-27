// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ActorOrViewerLocalTimeLine } from "../../src/components/ActorOrViewerLocalTimeLine.js";
import { LocalTimeLine, TimeStack, TimeText, TimeWithZone } from "../../src/components/TimeStack.js";
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

describe("the quiet zone of a time", () => {
  const zoneOf = (text: string) => {
    const { container } = render(<TimeWithZone text={text} />);
    return { zone: container.querySelector(".time-stack__zone")?.textContent ?? null, whole: container.textContent };
  };

  it.each([
    ["2026-11-25 20:40:14 UTC", " UTC"],
    ["05 Jan 2026, 09:30 UTC", " UTC"],
    ["05 Jan 2026, 15:00 UTC+5:30", " UTC+5:30"],
    ["05 Jan 2026, 06:00 UTC-3", " UTC-3"],
    ["05 Jan 2026, 15:00 UTC+02:00", " UTC+02:00"],
  ])("puts the zone at the end of %s in its own element and leaves the text as it was", (text, zone) => {
    const result = zoneOf(text);
    expect(result.zone).toBe(zone);
    expect(result.whole).toBe(text);
  });

  it.each(["-", "14:05", "UTC", "Just now", "2026-11-25 20:40:14 UTC later", "05 Jan 2026, 15:00 UTC+abc", "05 Jan 2026, 15:00 UTC+123", "05 Jan 2026, 15:00 UTC+5:3", "05 Jan 2026, 15:00 UTC+5:30:15", "05 Jan 2026, 15:00 UTC+"])("leaves %s as plain text: it has no zone at its end", (text) => {
    const result = zoneOf(text);
    expect(result.zone).toBeNull();
    expect(result.whole).toBe(text);
  });

  it("is used for the primary line of a TimeStack when that is text, and not for anything else", () => {
    const { container } = render(<TimeStack primary="2026-11-25 14:50:00 UTC" />);
    expect(container.querySelector(".time-stack__utc .time-stack__zone")?.textContent).toBe(" UTC");

    cleanup();
    const node = render(
      <TimeStack primary={<b>{"2026-11-25 14:50:00 UTC"}</b>} />,
    );
    expect(node.container.querySelector(".time-stack__zone")).toBeNull();
  });

  it("is used by TimeText, which keeps the class of a plain time", () => {
    const { container } = render(<TimeText>{"05 Jan 2026, 15:00 UTC+5:30"}</TimeText>);
    const span = container.querySelector("span.time-text");
    expect(span?.textContent).toBe("05 Jan 2026, 15:00 UTC+5:30");
    expect(span?.querySelector(".time-stack__zone")?.textContent).toBe(" UTC+5:30");
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
