import { describe, expect, it } from "vitest";
import { assertTestDatabaseUrl } from "../src/testDbGuard.js";

describe("assertTestDatabaseUrl", () => {
  it("allows a local host with a non-test database name", () => {
    expect(() =>
      assertTestDatabaseUrl("postgresql://admitto:admitto@localhost:5432/admitto"),
    ).not.toThrow();
  });

  it("allows 127.0.0.1 and ::1 hosts", () => {
    expect(() =>
      assertTestDatabaseUrl("postgresql://admitto:admitto@127.0.0.1:5432/admitto_db_test"),
    ).not.toThrow();
    expect(() =>
      assertTestDatabaseUrl("postgresql://admitto:admitto@[::1]:5432/admitto_db_test"),
    ).not.toThrow();
  });

  it("allows a non-local host when the database name contains _test", () => {
    expect(() =>
      assertTestDatabaseUrl("postgresql://admitto:admitto@ci-postgres:5432/admitto_auth_test"),
    ).not.toThrow();
  });

  it("refuses a non-local host with a non-test database name", () => {
    expect(() =>
      assertTestDatabaseUrl("postgresql://admitto:admitto@prod-host.internal:5432/admitto_claude_code"),
    ).toThrow(/Refusing Prisma setup.*prod-host\.internal.*admitto_claude_code/);
  });

  it("refuses a non-local URL with no database name at all", () => {
    expect(() => assertTestDatabaseUrl("postgresql://admitto:admitto@prod-host.internal:5432/")).toThrow(
      /database "\(default\)"/,
    );
  });

  it("refuses an invalid URL", () => {
    expect(() => assertTestDatabaseUrl("not-a-url")).toThrow(
      "Refusing Prisma setup: DATABASE_URL is not a valid URL",
    );
  });

  it("refuses an empty string", () => {
    expect(() => assertTestDatabaseUrl("")).toThrow(
      "Refusing Prisma setup: DATABASE_URL is not a valid URL",
    );
  });
});
