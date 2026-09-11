import { describe, expect, it } from "vitest";
import {
  redactAttendeeListFiltersForStorage,
  scrubExportJobResultJson,
} from "../src/export-job-privacy.js";

describe("redactAttendeeListFiltersForStorage", () => {
  it("replaces raw q with has_query", () => {
    expect(
      redactAttendeeListFiltersForStorage({
        q: "Ada Lovelace",
        status: "confirmed",
        ticket_type: ["vip"],
      }),
    ).toEqual({
      status: "confirmed",
      ticket_type: ["vip"],
      rsvp_status: undefined,
      mail_status: undefined,
      has_query: true,
    });
  });

  it("sets has_query false when q is blank", () => {
    expect(redactAttendeeListFiltersForStorage({ q: "  ", status: "all" })).toEqual({
      status: "all",
      ticket_type: null,
      rsvp_status: undefined,
      mail_status: undefined,
      has_query: false,
    });
  });

  it("scrubs a text custom field's value to has_text, keeps select/boolean values verbatim", () => {
    expect(
      redactAttendeeListFiltersForStorage({
        status: "all",
        customFields: [
          { source_field: "dietary_notes", type: "text", text: "no nuts, allergic" },
          { source_field: "t_shirt_size", type: "select", values: ["M", "L"] },
          { source_field: "dinner", type: "boolean", values: ["true"] },
        ],
      }),
    ).toEqual({
      status: "all",
      ticket_type: null,
      rsvp_status: undefined,
      mail_status: undefined,
      customFields: [
        { source_field: "dietary_notes", type: "text", has_text: true },
        { source_field: "t_shirt_size", type: "select", values: ["M", "L"] },
        { source_field: "dinner", type: "boolean", values: ["true"] },
      ],
      has_query: false,
    });
  });

  it("sets has_text false for an empty text custom field, and leaves customFields undefined when absent", () => {
    expect(
      redactAttendeeListFiltersForStorage({
        status: "all",
        customFields: [{ source_field: "dietary_notes", type: "text", text: "" }],
      }).customFields,
    ).toEqual([{ source_field: "dietary_notes", type: "text", has_text: false }]);

    expect(redactAttendeeListFiltersForStorage({ status: "all" }).customFields).toBeUndefined();
  });
});

describe("scrubExportJobResultJson", () => {
  it("scrubs nested request.filters.q", () => {
    expect(
      scrubExportJobResultJson({
        request: {
          kind: "attendees_filtered",
          format: "csv",
          filters: { q: "secret@example.com", status: "all" },
        },
        rowCount: 3,
      }),
    ).toEqual({
      request: {
        kind: "attendees_filtered",
        format: "csv",
        filters: {
          status: "all",
          ticket_type: null,
          rsvp_status: undefined,
          mail_status: undefined,
          has_query: true,
        },
      },
      rowCount: 3,
    });
  });

  it("returns non-objects and arrays unchanged", () => {
    expect(scrubExportJobResultJson(null)).toBeNull();
    expect(scrubExportJobResultJson("x")).toBe("x");
    expect(scrubExportJobResultJson([1])).toEqual([1]);
  });

  it("leaves the root alone when request or filters are not plain objects", () => {
    expect(scrubExportJobResultJson({ request: "nope", rowCount: 1 })).toEqual({
      request: "nope",
      rowCount: 1,
    });
    expect(scrubExportJobResultJson({ request: { filters: null } })).toEqual({
      request: { filters: null },
    });
    expect(scrubExportJobResultJson({ request: { filters: ["q"] } })).toEqual({
      request: { filters: ["q"] },
    });
  });
});
