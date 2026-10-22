import { describe, expect, it } from "vitest";
import { stripDumpForWorkerSchema } from "../provisionWorkerSchemas.js";

/** The start of what pg_dump 17 and later write: the settings that a server older than 17 refuses, among others. */
const PREAMBLE = [
  "SET statement_timeout = 0;",
  "SET lock_timeout = 0;",
  "SET idle_in_transaction_session_timeout = 0;",
  "SET transaction_timeout = 0;",
  "SET client_encoding = 'UTF8';",
  "SELECT pg_catalog.set_config('search_path', '', false);",
].join("\n");

describe("stripDumpForWorkerSchema", () => {
  it("drops the setting that only PostgreSQL 17 and later know, and keeps the other settings of the preamble", () => {
    const stripped = stripDumpForWorkerSchema(PREAMBLE);

    expect(stripped).not.toContain("transaction_timeout");
    expect(stripped.split("\n")).toEqual([
      "SET statement_timeout = 0;",
      "SET lock_timeout = 0;",
      "SET idle_in_transaction_session_timeout = 0;",
      "SET client_encoding = 'UTF8';",
      "SELECT pg_catalog.set_config('search_path', '', false);",
    ]);
  });

  it("leaves a dump from an older client alone, which has no such line", () => {
    const older = PREAMBLE.replace("SET transaction_timeout = 0;\n", "");

    expect(stripDumpForWorkerSchema(older)).toBe(older);
  });

  it("still drops the bootstrap of the public schema", () => {
    const dump = [
      "CREATE SCHEMA public;",
      "ALTER SCHEMA public OWNER TO admitto;",
      "COMMENT ON SCHEMA public IS 'standard public schema';",
      "-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: admitto",
      'CREATE TABLE public."Event" (id text);',
    ].join("\n");

    expect(stripDumpForWorkerSchema(dump)).toBe('CREATE TABLE public."Event" (id text);');
  });

  it("does not touch a line that only mentions the setting somewhere else", () => {
    const comment = "-- SET transaction_timeout = 0; is what a newer pg_dump writes";
    const indented = "  SET transaction_timeout = 0;";

    expect(stripDumpForWorkerSchema([comment, indented].join("\n"))).toBe([comment, indented].join("\n"));
  });
});
