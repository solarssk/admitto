import { REGISTRATION_STATUS } from "@admitto/db/status";
import { STATUS_MAP } from "@admitto/ui";
import { describe, expect, it } from "vitest";

// The plain key of a registration status already means something else in the status map ("rejected" is
// a job that failed, "accepted" a mail that was handed over, "pending" a mail still queued), so a
// badge is drawn with `registration_<status>`. A status without that key would show its raw name, and a
// caller that used the plain key would show the other meaning: this fails when a status is added to the
// database list and not to the map.
describe("registration status badges", () => {
  it.each(REGISTRATION_STATUS)("%s has a registration_ key in the status map", (status) => {
    expect(Object.hasOwn(STATUS_MAP, `registration_${status}`)).toBe(true);
  });
});
