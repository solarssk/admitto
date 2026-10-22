// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { attendeeFieldAttrs, NO_AUTOFILL_PROPS } from "../../src/utils/no-autofill.js";
import { bitwardenTreatsAsSearchField } from "../checkin/bitwardenSearchField.js";

describe("attendeeFieldAttrs", () => {
  it("is the shared opt-out plus a name that reads as a search box to Bitwarden, which honours the opt-out only for a user who asked", () => {
    const attrs = attendeeFieldAttrs("add-attendee-contact");
    expect(attrs).toMatchObject(NO_AUTOFILL_PROPS);
    expect(attrs.name).toBe("add-attendee-contact-search");

    const input = document.createElement("input");
    input.setAttribute("name", attrs.name);
    expect(bitwardenTreatsAsSearchField(input)).toBe(true);
  });

  it("tells the fields of a form apart by the key it is given", () => {
    expect(attendeeFieldAttrs("edit-attendee-given").name).not.toBe(attendeeFieldAttrs("edit-attendee-family").name);
  });
});
