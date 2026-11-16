import { describe, expect, it } from "vitest";
import { botProtectionApplies } from "../src/registration/bot-protection-mode.js";

describe("botProtectionApplies: the check is on only while the organisation's switch AND the event's switch are on", () => {
  it.each([
    ["required", true, true],
    ["required", false, false],
    ["not_used", true, false],
    ["not_used", false, false],
  ] as const)("is %s for the organisation and %s for the event: %s", (mode, eventEnabled, expected) => {
    expect(botProtectionApplies(mode, eventEnabled)).toBe(expected);
  });
});
