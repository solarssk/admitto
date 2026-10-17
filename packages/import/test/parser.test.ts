import { describe, expect, it } from "vitest";
import { csvRecords } from "../src/csv-records.js";
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

  it("rejects a single name column - first_name and last_name are always required", () => {
    const result = parseAttendees(`name,email\nJan Kowalski,jan@example.com`);
    expect(result.validRows).toHaveLength(0);
    expect(result.invalidRows[0]).toMatchObject({ reason: "Both first_name and last_name are required" });
  });

  it("rejects a row missing last_name even when first_name is present", () => {
    const result = parseAttendees(`${VALID_HEADER}\nCher,,cher@example.com`);
    expect(result.validRows).toHaveLength(0);
    expect(result.invalidRows[0]).toMatchObject({ reason: "Both first_name and last_name are required" });
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

describe("parseAttendees — reserved addresses", () => {
  it("rejects an address in the namespace reserved for erased attendees", () => {
    const result = parseAttendees(`${VALID_HEADER}\nJan,Kowalski,erased-att-1@Erased.Invalid\nAna,Nowak,ana@example.com`);
    expect(result.validRows.map((row) => row.email)).toEqual(["ana@example.com"]);
    expect(result.invalidRows).toHaveLength(1);
    expect(result.invalidRows[0]?.reason).toContain("Invalid email");
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

  it("warns about a removed `name` column instead of silently discarding it (Codex review, PR792)", () => {
    const result = parseAttendees(`name,first_name,last_name,email\nJan Kowalski,Jan,K,jan@example.com`);
    expect(result.warnings.some((w) => w.includes('Unknown column ignored: "name"'))).toBe(true);
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
    expect(result.invalidRows[0]?.reason).toBe("Both first_name and last_name are required");
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


describe("logical multiline CSV records", () => {
  it.each(["\n", "\r\n"])("preserves quoted %j with commas and escaped quotes", (newline) => {
    const company = `Synthetic, "Team"${newline}Headquarters`;
    const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
    const csv = `\uFEFFfirst_name,last_name,email,company,notes${newline}` +
      [quote(`Synthetic${newline}First`), "Person", "multiline@example.com", quote(company), quote(`One${newline}${newline}Two`)].join(",") +
      `${newline}${newline}Bad,,bad@example.com${newline}Last,Person,last@example.com`;
    const parsed = parseAttendees(csv, { attributeFields: [{ source_field: "notes", label: "Notes", type: "text" }] });
    expect(parsed.validRows).toHaveLength(2);
    expect(parsed.validRows[0]).toMatchObject({ rowIndex: 1, first_name: `Synthetic${newline}First`, company, custom_data: { notes: `One${newline}${newline}Two` } });
    expect(parsed.invalidRows).toHaveLength(1);
    expect(parsed.invalidRows[0]?.rowIndex).toBe(2);
    expect(parsed.validRows[1]?.rowIndex).toBe(3);
  });

  it.each([
    'Synthetic,Person,quoted@example.com,"Unclosed\ncompany',
    'Synthetic,Person,quoted@example.com,"Closed"garbage',
    'Synthetic,Person,quoted@example.com,Company,extra',
  ])("rejects malformed records with a fixed diagnostic", (row) => {
    const result = parseAttendees(`first_name,last_name,email,company\n${row}`);
    expect(result.validRows).toHaveLength(0);
    expect(result.invalidRows).toEqual([{ rowIndex: 1, raw: {}, reason: "Malformed CSV record" }]);
  });

  it("retains ordinary seeded single-line records and quoted empty optional cells", () => {
    const rows = Array.from({ length: 100 }, (_, index) => `"Synthetic ${index}","Comma, ""Person""",seed-${index}@example.com,""`);
    const result = parseAttendees(["first_name,last_name,email,company", ...rows].join("\n"));
    expect(result.invalidRows).toEqual([]);
    expect(result.validRows).toHaveLength(100);
    expect(result.validRows[99]).toMatchObject({ rowIndex: 100, first_name: "Synthetic 99", last_name: 'Comma, "Person"', email: "seed-99@example.com" });
  });
});


describe("CSV logical-record boundaries", () => {
  it("keeps blank lines and trailing whitespace inside quoted cells", () => {
    const result = parseAttendees('first_name,last_name,email,company\nSynthetic,Person,spaces@example.com,"One  \n\nTwo"\n');
    expect(result.invalidRows).toEqual([]);
    expect(result.validRows[0]?.company).toBe("One  \n\nTwo");
  });

  it("reports an unclosed header without treating its contents as attendee rows", () => {
    expect(parseAttendees('"first_name,last_name,email\nSynthetic,Person,private@example.com')).toEqual({
      validRows: [], invalidRows: [], warnings: ["Malformed CSV header"],
    });
  });

  it.each(['"closed" ,rest', '"closed"\t,rest', '"closed"oops,rest'])("flags trailing quoted-field garbage", (text) => {
    expect([...csvRecords(text)]).toEqual([{ text, malformed: true }]);
  });

  it("preserves unquoted literal quotes and allows whitespace only at a record end", () => {
    const csv = 'first_name,last_name,email,company\nSynthetic,Person,literal@example.com,Team "One"\nSecond,Person,second@example.com,"Team Two"  \r\n';
    const result = parseAttendees(csv);
    expect(result.invalidRows).toEqual([]);
    expect(result.validRows.map((row) => row.company)).toEqual(['Team "One"', 'Team Two']);
  });
});


describe("parseAttendees - separators saved by spreadsheet programs", () => {
  const BOM = String.fromCharCode(0xfeff);
  const people = [
    ["Łukasz", "Wiśniewski", "lukasz.wisniewski@example.com"],
    ["Żaneta", "Dąbrowska", "zaneta.dabrowska@example.com"],
  ];
  const fileWith = (separator: string, newline = "\r\n") =>
    [["first_name", "last_name", "email"], ...people].map((cells) => cells.join(separator)).join(newline) + newline;

  it.each([
    ["a comma", ","],
    ["a semicolon (Polish Excel)", ";"],
    ["a tab", "\t"],
  ])("reads a file separated by %s", (_label, separator) => {
    const result = parseAttendees(fileWith(separator));
    expect(result.warnings).toEqual([]);
    expect(result.invalidRows).toEqual([]);
    expect(result.validRows.map((row) => [row.first_name, row.last_name, row.email])).toEqual(people);
  });

  it("reads a semicolon file that starts with a byte order mark (Excel CSV UTF-8)", () => {
    const result = parseAttendees(BOM + fileWith(";"));
    expect(result.warnings).toEqual([]);
    expect(result.validRows).toHaveLength(2);
  });

  it("keeps commas, quoted separators and quoted line breaks inside the cells of a semicolon file", () => {
    const csv = [
      "first_name;last_name;email;company",
      "Ada;Test;ada@example.com;Acme, Inc",
      'Eve;Example;eve@example.com;"Acme; North"',
      'Max;Sample;max@example.com;"Head\r\nquarters"',
      "Zed;Last;zed@example.com;",
    ].join("\n");
    const result = parseAttendees(csv);
    expect(result.invalidRows).toEqual([]);
    expect(result.validRows.map((row) => [row.rowIndex, row.company])).toEqual([
      [1, "Acme, Inc"],
      [2, "Acme; North"],
      [3, "Head\r\nquarters"],
      [4, undefined],
    ]);
  });

  it("numbers the rows the same way whatever the separator is", () => {
    const rows = (separator: string) => parseAttendees(fileWith(separator)).validRows.map((row) => row.rowIndex);
    expect(rows(";")).toEqual(rows(","));
    expect(rows("\t")).toEqual(rows(","));
  });

  it("flags a malformed record in a semicolon file as it does in a comma file", () => {
    const result = parseAttendees('first_name;last_name;email;company\nAda;Test;ada@example.com;"Closed"garbage');
    expect(result.invalidRows).toEqual([{ rowIndex: 1, raw: {}, reason: "Malformed CSV record" }]);
  });

  it("keeps the comma when no separator makes the header match", () => {
    const result = parseAttendees("name;mail\nAda;ada@example.com");
    expect(result.warnings).toContain('Unknown column ignored: "name;mail"');
  });

  it("keeps the comma when two separators match the header equally", () => {
    const result = parseAttendees("first_name,last_name;email\nAda,Test;ada@example.com");
    expect(result.warnings).toContain('Unknown column ignored: "last_name;email"');
  });
});

describe("csvRecords - separators", () => {
  it.each([";", "\t"])("keeps a quoted line break inside one record when the separator is %j", (separator) => {
    const header = ["first_name", "last_name", "email", "company"].join(separator);
    const row = ["Ada", "Test", "ada@example.com", '"Head\nquarters"'].join(separator);
    expect([...csvRecords(`${header}\n${row}\n`)].map((record) => record.malformed)).toEqual([false, false]);
  });

  it("uses the separator it is given instead of detecting one", () => {
    const csv = 'first_name;last_name;email\nAda;Test;"a\nb@example.com"\n';
    expect([...csvRecords(csv, ";")]).toHaveLength(2);
    expect([...csvRecords(csv)]).toHaveLength(2);
    expect([...csvRecords(csv, ",")]).toHaveLength(3);
  });
});

it("round-trips bounded seeded quoted records with delimiters, quotes, Unicode and newlines", () => {
  let seed = 741819;
  const next = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
  const parts = ["Synthetic", ",", '"', "\n", "\r\n", " ", "é", "ł", "\t"];
  const values = Array.from({ length: 200 }, () => "Start" + Array.from({ length: 12 }, () => parts[next() % parts.length]!).join("") + "End");
  const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
  const csv = ["first_name,last_name,email,company", ...values.map((value, index) => `Synthetic,Person,property-${index}@example.com,${quote(value)}`)].join("\n");
  const parsed = parseAttendees(csv);
  expect(parsed.invalidRows).toEqual([]);
  expect(parsed.validRows.map((row) => row.company)).toEqual(values);
  expect(parsed.validRows.map((row) => row.rowIndex)).toEqual(values.map((_, index) => index + 1));
});
