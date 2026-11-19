import { describe, expect, it } from "vitest";
import { eventPlaceName, eventTimeNote } from "../../src/registration/event-place-name.js";

describe("the name of the event's place", () => {
  it.each([
    ["America/Los_Angeles", "Los Angeles"],
    ["America/New_York", "New York"],
    ["Asia/Kolkata", "Kolkata"],
    ["Europe/Warsaw", "Warsaw"],
    ["America/Argentina/Buenos_Aires", "Buenos Aires"],
    ["America/Indiana/Indianapolis", "Indianapolis"],
    ["Pacific/Port_Moresby", "Port Moresby"],
  ])("is the last part of %s, with spaces for the underscores", (zone, name) => {
    expect(eventPlaceName(zone)).toBe(name);
  });

  it.each(["UTC", "GMT", "UCT", "Zulu", "Universal", "Greenwich", "Etc/UTC", "Etc/GMT", "Etc/Zulu", "Etc/Universal"])("is UTC for %s", (zone) => {
    expect(eventPlaceName(zone)).toBe("UTC");
  });

  it("is the long name of a fixed offset, which names no place", () => {
    expect(eventPlaceName("Etc/GMT+5")).toBe("GMT-05:00");
    expect(eventPlaceName("Etc/GMT-3")).toBe("GMT+03:00");
  });

  it("keeps a one-word zone that is a place, and gives the long name to one that is a code", () => {
    expect(eventPlaceName("Poland")).toBe("Poland");
    expect(eventPlaceName("Japan")).toBe("Japan");
    expect(eventPlaceName("EST5EDT")).toBe("Eastern Standard Time");
    expect(eventPlaceName("CET")).toBe("Central European Standard Time");
  });

  it("shows a zone the platform does not know by its last part, and never throws", () => {
    expect(eventPlaceName("Mars/Olympus_Mons")).toBe("Olympus Mons");
    expect(eventPlaceName("XYZ123")).toBe("XYZ123");
    expect(eventPlaceName("")).toBe("");
  });

  it("never shows an underscore or a region", () => {
    for (const zone of Intl.supportedValuesOf("timeZone")) {
      const name = eventPlaceName(zone);
      expect(name, zone).not.toMatch(/[_/]/);
      expect(name, zone).not.toBe("");
    }
  });

  it("says in one sentence whose clock to use", () => {
    expect(eventTimeNote("America/Los_Angeles")).toBe("Use the event's local time (Los Angeles).");
    expect(eventTimeNote("UTC")).toBe("Use the event's local time (UTC).");
  });
});
