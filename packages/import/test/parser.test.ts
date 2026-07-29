import { describe, expect, it } from "vitest";
import { parseAttendees } from "../src/parser.js";

const VALID_HEADER = "first_name,last_name,email";

describe("parseAttendees — basic valid rows", () => {
  it("parses a minimal Mode A row", () => {
    const result = parseAttendees(`${VALID_HEADER}\nJan,Kowalski,jan@example.com`);
    expect(result.validRows).toHaveLength(1);
    expect(result.validRows[0]).toMatchObject({ first_name: "Jan", last_name: "Kowalski", email: "jan@example.com" });
    expect(result.invalidRows).toHaveLength(0);
  });

  it("parses a Mode B row with external_uuid and qr_payload", () => {
    const result = parseAttendees(
      `first_name,last_name,email,external_uuid,qr_payload\nAna,Nowak,ana@example.com,uuid-999,AGENCY-QR-123`,
    );
    expect(result.validRows[0]).toMatchObject({
      email: "ana@example.com",
      external_uuid: "uuid-999",
      qr_payload: "AGENCY-QR-123",
    });
  });

  it("accepts a single name column instead of first_name + last_name", () => {
    const result = parseAttendees(`name,email\nJan Kowalski,jan@example.com`);
    expect(result.validRows[0]).toMatchObject({ first_name: "Jan", last_name: "Kowalski" });
    expect(result.invalidRows).toHaveLength(0);
  });

  it("warns and preserves a single-word name with an empty last name", () => {
    const result = parseAttendees(`name,email\nCher,cher@example.com`);

    expect(result.validRows[0]).toMatchObject({ first_name: "Cher", last_name: "" });
    expect(result.warnings).toContain('Row 1: single-word name "Cher", last_name stored as empty string');
  });

  it("normalises email to lower-case", () => {
    const result = parseAttendees(`${VALID_HEADER}\nJan,K,JAN@Example.COM`);
    expect(result.validRows[0]?.email).toBe("jan@example.com");
  });

  it("trims whitespace from values", () => {
    const result = parseAttendees(`${VALID_HEADER}\n  Jan ,  K , jan@example.com `);
    expect(result.validRows[0]?.first_name).toBe("Jan");
  });

  it("assigns rowIndex matching file line index for valid rows", () => {
    const csv = [
      VALID_HEADER,
      "Jan,Kowalski,jan@example.com",
      "Bad,,bad@example.com",
      "Eve,Example,eve@example.com",
    ].join("\n");
    const result = parseAttendees(csv);
    expect(result.validRows).toHaveLength(2);
    expect(result.validRows[0]?.rowIndex).toBe(1);
    expect(result.validRows[1]?.rowIndex).toBe(3);
    expect(result.invalidRows[0]?.rowIndex).toBe(2);
  });
});

describe("parseAttendees — header normalisation", () => {
  it("handles case-insensitive headers", () => {
    const result = parseAttendees(`EMAIL,FIRST_NAME,LAST_NAME\njan@example.com,Jan,K`);
    expect(result.validRows).toHaveLength(1);
    expect(result.validRows[0]?.email).toBe("jan@example.com");
  });

  it("warns about unknown columns but still parses valid rows", () => {
    const result = parseAttendees(`first_name,last_name,email,unknown_col\nJan,K,jan@example.com,ignored`);
    expect(result.warnings.some((w) => w.includes("unknown_col"))).toBe(true);
    expect(result.validRows).toHaveLength(1);
  });

  it("warns when the required email column is absent", () => {
    const result = parseAttendees("first_name,last_name\nJan,Kowalski");
    expect(result.warnings).toContain("CSV has no 'email' column. All rows will be invalid");
  });
});

describe("parseAttendees — event attribute columns", () => {
  const shirtField = {
    label: "Shirt size",
    source_field: "shirt_size",
    type: "select" as const,
    required: true,
    options: ["S", "M", "L"],
  };

  it("parses and validates custom attribute columns by source_field slug", () => {
    const result = parseAttendees(
      `first_name,last_name,email,shirt_size\nJan,K,jan@example.com,M`,
      { attributeFields: [shirtField] },
    );
    expect(result.validRows).toHaveLength(1);
    expect(result.validRows[0]?.custom_data).toEqual({ shirt_size: "M" });
    expect(result.warnings.some((w) => w.includes("shirt_size"))).toBe(false);
  });

  it("accepts export-style label headers for round-trip", () => {
    const result = parseAttendees(
      `first_name,last_name,email,Shirt size\nJan,K,jan@example.com,L`,
      { attributeFields: [shirtField] },
    );
    expect(result.validRows[0]?.custom_data).toEqual({ shirt_size: "L" });
  });

  it("rejects invalid select option", () => {
    const result = parseAttendees(
      `first_name,last_name,email,shirt_size\nJan,K,jan@example.com,XL`,
      { attributeFields: [shirtField] },
    );
    expect(result.validRows).toHaveLength(0);
    expect(result.invalidRows[0]?.reason).toMatch(/invalid value for shirt size/i);
  });

  it("allows rows omitting required attribute columns (validated at commit)", () => {
    const result = parseAttendees(`${VALID_HEADER}\nJan,K,jan@example.com`, {
      attributeFields: [shirtField],
    });
    expect(result.validRows).toHaveLength(1);
    expect(result.validRows[0]?.custom_data).toBeUndefined();
  });
});

describe("parseAttendees — ticket type catalog validation (batch 04 / #351)", () => {
  const catalog = [{ key: "vip", label: "VIP" }];

  it("rejects a ticket_type not in the catalog, with a clear per-row reason", () => {
    const result = parseAttendees(
      `${VALID_HEADER},ticket_type\nJan,K,jan@example.com,staff`,
      { ticketTypes: catalog },
    );
    expect(result.validRows).toHaveLength(0);
    expect(result.invalidRows[0]?.reason).toMatch(/unknown ticket type: "staff"/i);
  });

  it("normalizes a matched ticket_type to the catalog's canonical key (case-insensitive)", () => {
    const result = parseAttendees(
      `${VALID_HEADER},ticket_type\nJan,K,jan@example.com,VIP`,
      { ticketTypes: catalog },
    );
    expect(result.validRows).toHaveLength(1);
    expect(result.validRows[0]?.ticket_type).toBe("vip");
  });

  it("does not validate ticket_type when the caller opts out (ticketTypes undefined)", () => {
    const result = parseAttendees(`${VALID_HEADER},ticket_type\nJan,K,jan@example.com,whatever`);
    expect(result.validRows).toHaveLength(1);
    expect(result.validRows[0]?.ticket_type).toBe("whatever");
  });

  it("does not reject a row with no ticket_type value at all, even with a catalog set", () => {
    const result = parseAttendees(`${VALID_HEADER}\nJan,K,jan@example.com`, { ticketTypes: catalog });
    expect(result.validRows).toHaveLength(1);
    expect(result.validRows[0]?.ticket_type).toBeUndefined();
  });
});

describe("parseAttendees — invalid rows", () => {
  it("rejects a row with invalid email", () => {
    const result = parseAttendees(`${VALID_HEADER}\nJan,K,not-an-email`);
    expect(result.invalidRows).toHaveLength(1);
    expect(result.invalidRows[0]?.reason).toMatch(/invalid email/i);
    expect(result.validRows).toHaveLength(0);
  });

  it("rejects a row with missing email", () => {
    const result = parseAttendees(`first_name,last_name,email\nJan,K,`);
    expect(result.invalidRows).toHaveLength(1);
    expect(result.invalidRows[0]?.reason).toMatch(/missing email/i);
  });

  it("rejects a row with only first_name (missing last_name)", () => {
    const result = parseAttendees(`first_name,last_name,email\nJan,,jan@example.com`);
    expect(result.invalidRows).toHaveLength(1);
    expect(result.invalidRows[0]?.reason).toMatch(/last_name/i);
  });

  it("rejects a row with only last_name (missing first_name)", () => {
    const result = parseAttendees(`first_name,last_name,email\n,Kowalski,jan@example.com`);
    expect(result.invalidRows).toHaveLength(1);
  });

  it("rejects a row with no name information at all", () => {
    const result = parseAttendees(`email\njan@example.com`);
    expect(result.invalidRows).toHaveLength(1);
    expect(result.invalidRows[0]?.reason).toMatch(/missing name/i);
  });
});

describe("parseAttendees — duplicate detection", () => {
  it("flags duplicate email within the file", () => {
    const csv = `${VALID_HEADER}\nJan,K,jan@example.com\nAna,K,jan@example.com`;
    const result = parseAttendees(csv);
    expect(result.validRows).toHaveLength(1);
    expect(result.invalidRows).toHaveLength(1);
    expect(result.invalidRows[0]?.reason).toMatch(/duplicate email/i);
  });

  it("flags duplicate external_uuid within the file", () => {
    const csv = `first_name,last_name,email,external_uuid\nJan,K,jan@example.com,uuid-1\nAna,K,ana@example.com,uuid-1`;
    const result = parseAttendees(csv);
    expect(result.validRows).toHaveLength(1);
    expect(result.invalidRows).toHaveLength(1);
    expect(result.invalidRows[0]?.reason).toMatch(/duplicate external_uuid/i);
  });

  it("flags duplicate qr_payload within the file", () => {
    const csv = `first_name,last_name,email,qr_payload\nJan,K,jan@example.com,QR-1\nAna,K,ana@example.com,QR-1`;
    const result = parseAttendees(csv);
    expect(result.validRows).toHaveLength(1);
    expect(result.invalidRows).toHaveLength(1);
    expect(result.invalidRows[0]?.reason).toMatch(/duplicate qr_payload/i);
  });

  it("flags cross-column collisions between external_uuid and qr_payload", () => {
    const csv = `first_name,last_name,email,external_uuid,qr_payload\nJan,K,jan@example.com,AGENCY-X,\nAna,K,ana@example.com,,AGENCY-X`;
    const result = parseAttendees(csv);
    expect(result.validRows).toHaveLength(1);
    expect(result.invalidRows).toHaveLength(1);
    expect(result.invalidRows[0]?.reason).toMatch(/collides across columns/i);
  });

  it("flags cross-column collisions when a prior QR payload is reused as an external UUID", () => {
    const csv = `first_name,last_name,email,external_uuid,qr_payload\nJan,K,jan@example.com,,AGENCY-X\nAna,K,ana@example.com,AGENCY-X,`;
    const result = parseAttendees(csv);

    expect(result.validRows).toHaveLength(1);
    expect(result.invalidRows[0]?.reason).toBe('Agency identifier collides across columns: "AGENCY-X"');
  });

  it("does not flag duplicate external_uuid when both are empty", () => {
    const csv = `first_name,last_name,email,external_uuid\nJan,K,jan@example.com,\nAna,K,ana@example.com,`;
    const result = parseAttendees(csv);
    expect(result.validRows).toHaveLength(2);
    expect(result.invalidRows).toHaveLength(0);
  });

  it("does not flag duplicate qr_payload when both are empty", () => {
    const csv = `first_name,last_name,email,qr_payload\nJan,K,jan@example.com,\nAna,K,ana@example.com,`;
    const result = parseAttendees(csv);
    expect(result.validRows).toHaveLength(2);
    expect(result.invalidRows).toHaveLength(0);
  });
});

describe("parseAttendees — edge cases", () => {
  it("returns empty result with warning for empty CSV string", () => {
    const result = parseAttendees("");
    expect(result.validRows).toHaveLength(0);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("returns warning when CSV has only a header row", () => {
    const result = parseAttendees(`${VALID_HEADER}`);
    expect(result.validRows).toHaveLength(0);
    expect(result.warnings.some((w) => w.toLowerCase().includes("no data"))).toBe(true);
  });

  it("handles quoted fields with embedded commas", () => {
    const result = parseAttendees(`first_name,last_name,email\n"Smith, Jr.",John,john@example.com`);
    expect(result.validRows[0]?.first_name).toBe("Smith, Jr.");
  });

  it("skips blank lines between data rows", () => {
    const result = parseAttendees(`${VALID_HEADER}\nJan,K,jan@example.com\n\nAna,K,ana@example.com`);
    expect(result.validRows).toHaveLength(2);
  });

  it("skips whitespace-only lines between data rows", () => {
    const result = parseAttendees(`${VALID_HEADER}\nJan,K,jan@example.com\n   \nAna,K,ana@example.com`);
    expect(result.validRows).toHaveLength(2);
  });

  it("warns on duplicate headers and preserves the last value", () => {
    const result = parseAttendees(`email,first_name,last_name,email\nx@example.com,Jan,K,y@example.com`);
    expect(result.warnings.some((w) => /duplicate column/i.test(w))).toBe(true);
    expect(result.validRows[0]?.email).toBe("y@example.com");
  });

  it("treats a missing trailing optional cell as empty", () => {
    const result = parseAttendees("first_name,last_name,email,external_uuid\nJan,K,jan@example.com");

    expect(result.validRows).toEqual([
      expect.objectContaining({
        first_name: "Jan",
        last_name: "K",
        email: "jan@example.com",
      }),
    ]);
    expect(result.validRows[0]).not.toHaveProperty("external_uuid");
  });

  it("handles CRLF line endings", () => {
    const result = parseAttendees(`${VALID_HEADER}\r\nJan,K,jan@example.com\r\n`);
    expect(result.validRows).toHaveLength(1);
  });
});
