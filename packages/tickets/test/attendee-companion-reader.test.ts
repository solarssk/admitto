import { describe, expect, it } from "vitest";
import { MAX_COMPANION_SLOTS, readRegistrationCompanions } from "../src/attendee-companion.js";
import { seatsNeeded } from "../src/registration-seats.js";

const companion = (name: string, customData: Record<string, string> | null = {}) => ({ name, custom_data: customData });

describe("readRegistrationCompanions", () => {
  it("reads what a registration stores: a list of a name and the answers", () => {
    expect(readRegistrationCompanions([companion("Companion Example", { diet: "vegan" })])).toEqual([
      { name: "Companion Example", custom_data: { diet: "vegan" } },
    ]);
  });

  it("trims the name, and has no answers when the entry holds none or something that is not a set of answers", () => {
    expect(readRegistrationCompanions([{ name: "  Companion Example  " }])).toEqual([{ name: "Companion Example", custom_data: null }]);
    expect(readRegistrationCompanions([companion("Companion Example", null)])).toEqual([{ name: "Companion Example", custom_data: null }]);
    expect(readRegistrationCompanions([{ name: "Companion Example", custom_data: ["vegan"] }])).toEqual([
      { name: "Companion Example", custom_data: null },
    ]);
    expect(readRegistrationCompanions([{ name: "Companion Example", custom_data: "vegan" }])).toEqual([
      { name: "Companion Example", custom_data: null },
    ]);
  });

  it.each([
    ["nothing", undefined],
    ["null", null],
    ["an empty list", []],
    ["an object", { name: "Companion Example" }],
    ["a string", "Companion Example"],
    ["a number", 1],
  ])("finds no companion in %s", (_label, value) => {
    expect(readRegistrationCompanions(value as never)).toEqual([]);
  });

  it("leaves out an entry that is not shaped like a companion, and takes the next one that is", () => {
    const entries = [5, null, "Companion Example", ["Companion Example"], { name: 7 }, { name: "" }, { name: "   " }, { custom_data: {} }, companion("Valid Companion")];
    expect(readRegistrationCompanions(entries as never)).toEqual([{ name: "Valid Companion", custom_data: {} }]);
  });

  it("reads own properties only, never what the prototype chain offers", () => {
    const inherited = Object.create({ name: "Inherited Name" }) as object;
    expect(readRegistrationCompanions([inherited] as never)).toEqual([]);
  });

  it("reads at most as many companions as the application allows", () => {
    const entries = Array.from({ length: MAX_COMPANION_SLOTS + 2 }, (_, index) => companion(`Companion ${index + 1}`));
    const read = readRegistrationCompanions(entries);
    expect(read).toHaveLength(MAX_COMPANION_SLOTS);
    expect(read.map((entry) => entry.name)).toEqual(entries.slice(0, MAX_COMPANION_SLOTS).map((entry) => entry.name));
  });
});

describe("seatsNeeded", () => {
  it("is the guest alone when the registration holds no companion", () => {
    expect(seatsNeeded([])).toBe(1);
    expect(seatsNeeded(null)).toBe(1);
    expect(seatsNeeded({ name: "Companion Example" } as never)).toBe(1);
  });

  it("is a seat more for each companion", () => {
    expect(seatsNeeded([companion("Companion Example")])).toBe(2);
  });

  it("counts the companions an admission writes, and no others: the seats given are the rows made", () => {
    const stored = [5, { name: "" }, companion("Valid Companion"), companion("Another Companion"), companion("A Third One")];
    expect(seatsNeeded(stored as never)).toBe(1 + readRegistrationCompanions(stored as never).length);
    expect(seatsNeeded(stored as never)).toBe(1 + MAX_COMPANION_SLOTS);
  });
});
