import { describe, expect, it } from "vitest";
import { CliError } from "../src/lib/args.js";
import { assertSafeEmergencyExportOut } from "../src/lib/export-out-path.js";

const env = {
  EMERGENCY_EXPORT_DIR: "/app/emergency-exports",
  UPLOAD_DIR: "/app/uploads",
};

describe("assertSafeEmergencyExportOut", () => {
  it("allows paths under EMERGENCY_EXPORT_DIR", () => {
    expect(() =>
      assertSafeEmergencyExportOut("/app/emergency-exports/backup.csv", env),
    ).not.toThrow();
  });

  it("rejects paths under UPLOAD_DIR", () => {
    expect(() => assertSafeEmergencyExportOut("/app/uploads/leak.csv", env)).toThrow(CliError);
  });

  it("rejects traversal from emergency dir into uploads", () => {
    expect(() =>
      assertSafeEmergencyExportOut("/app/emergency-exports/../uploads/leak.csv", env),
    ).toThrow(CliError);
  });

  it("rejects paths outside EMERGENCY_EXPORT_DIR", () => {
    expect(() => assertSafeEmergencyExportOut("/tmp/backup.csv", env)).toThrow(CliError);
  });

  it("skips checks when env vars are unset", () => {
    expect(() => assertSafeEmergencyExportOut("/tmp/backup.csv", {})).not.toThrow();
  });
});
