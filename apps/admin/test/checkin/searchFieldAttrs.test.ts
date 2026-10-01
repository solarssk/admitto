import { describe, expect, it } from "vitest";
import { checkinSearchFieldAttrs } from "../../src/checkin/searchFieldAttrs.js";
import { NO_AUTOFILL_PROPS } from "../../src/settings/mailTransportFormParts.js";
import { NO_AUTOFILL_PROPS as SHARED } from "../../src/utils/no-autofill.js";

describe("check-in search field attributes", () => {
  it("are the shared password-manager opt-out plus what makes the field a search box, not a second copy of it", () => {
    expect(checkinSearchFieldAttrs).toMatchObject(NO_AUTOFILL_PROPS);
    expect(checkinSearchFieldAttrs.role).toBe("searchbox");
    expect(checkinSearchFieldAttrs.spellCheck).toBe(false);
  });

  it("the settings module still exports the very same opt-out, so its many importers are untouched", () => {
    expect(NO_AUTOFILL_PROPS).toBe(SHARED);
  });
});
