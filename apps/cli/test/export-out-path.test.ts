import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CliError } from "../src/lib/args.js";
import { assertSafeEmergencyExportOut, writeSafeEmergencyExportFile } from "../src/lib/export-out-path.js";

const dockerEnv = {
  EMERGENCY_EXPORT_DIR: "/app/emergency-exports",
  UPLOAD_DIR: "/app/uploads",
};

const tempRoots: string[] = [];

function makeTempLayout(): { emergency: string; uploads: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "admitto-export-out-"));
  tempRoots.push(root);
  const emergency = path.join(root, "emergency-exports");
  const uploads = path.join(root, "uploads");
  fs.mkdirSync(emergency, { recursive: true });
  fs.mkdirSync(uploads, { recursive: true });
  return { emergency, uploads };
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("assertSafeEmergencyExportOut", () => {
  it("allows paths under EMERGENCY_EXPORT_DIR", () => {
    expect(() =>
      assertSafeEmergencyExportOut("/app/emergency-exports/backup.csv", dockerEnv),
    ).not.toThrow();
  });

  it("rejects paths under UPLOAD_DIR", () => {
    expect(() => assertSafeEmergencyExportOut("/app/uploads/leak.csv", dockerEnv)).toThrow(CliError);
  });

  it("rejects traversal from emergency dir into uploads", () => {
    expect(() =>
      assertSafeEmergencyExportOut("/app/emergency-exports/../uploads/leak.csv", dockerEnv),
    ).toThrow(CliError);
  });

  it("rejects paths outside EMERGENCY_EXPORT_DIR", () => {
    expect(() => assertSafeEmergencyExportOut("/tmp/backup.csv", dockerEnv)).toThrow(CliError);
  });

  it("skips checks when env vars are unset", () => {
    expect(() => assertSafeEmergencyExportOut("/tmp/backup.csv", {})).not.toThrow();
  });

  it("rejects when --out is a symlink into UPLOAD_DIR", () => {
    const { emergency, uploads } = makeTempLayout();
    const target = path.join(uploads, "leak.csv");
    const link = path.join(emergency, "leak.csv");
    fs.symlinkSync(target, link);

    expect(() =>
      assertSafeEmergencyExportOut(link, {
        EMERGENCY_EXPORT_DIR: emergency,
        UPLOAD_DIR: uploads,
      }),
    ).toThrow(CliError);
  });

  it("rejects when EMERGENCY_EXPORT_DIR parent resolves into UPLOAD_DIR via symlink", () => {
    const { uploads } = makeTempLayout();
    const root = path.dirname(uploads);
    const emergencyLink = path.join(root, "emergency-via-uploads");
    fs.symlinkSync(uploads, emergencyLink);

    expect(() =>
      assertSafeEmergencyExportOut(path.join(emergencyLink, "leak.csv"), {
        EMERGENCY_EXPORT_DIR: emergencyLink,
        UPLOAD_DIR: uploads,
      }),
    ).toThrow(CliError);
  });

  it("rejects raw UPLOAD_DIR paths when a symlink resolves outside uploads", () => {
    const { emergency, uploads } = makeTempLayout();
    const exportLink = path.join(uploads, "export-link");
    fs.symlinkSync(emergency, exportLink);

    expect(() =>
      assertSafeEmergencyExportOut(path.join(exportLink, "report.csv"), {
        EMERGENCY_EXPORT_DIR: emergency,
        UPLOAD_DIR: uploads,
      }),
    ).toThrow(CliError);
  });

  it("writeSafeEmergencyExportFile rejects symlink planted before open", () => {
    const { emergency, uploads } = makeTempLayout();
    const out = path.join(emergency, "report.csv");
    fs.symlinkSync(path.join(uploads, "leaked.csv"), out);

    expect(() =>
      writeSafeEmergencyExportFile(out, "name,email\n", {
        EMERGENCY_EXPORT_DIR: emergency,
        UPLOAD_DIR: uploads,
      }),
    ).toThrow(CliError);
    expect(fs.existsSync(path.join(uploads, "leaked.csv"))).toBe(false);
  });

  it("writeSafeEmergencyExportFile persists full content across partial writeSync calls", () => {
    const { emergency, uploads } = makeTempLayout();
    const out = path.join(emergency, "report.csv");
    const content = "row\n".repeat(2000);
    const realWriteSync = fs.writeSync.bind(fs);
    let calls = 0;

    const spy = vi.spyOn(fs, "writeSync").mockImplementation((fd, buffer, ...rest) => {
      if (Buffer.isBuffer(buffer) && calls === 0) {
        calls++;
        const offset = typeof rest[0] === "number" ? rest[0] : 0;
        const length =
          typeof rest[1] === "number" ? rest[1] : buffer.length - offset;
        const chunk = Math.min(64, length);
        return realWriteSync(fd, buffer, offset, chunk);
      }
      return realWriteSync(fd, buffer, ...rest);
    });

    try {
      writeSafeEmergencyExportFile(out, content, {
        EMERGENCY_EXPORT_DIR: emergency,
        UPLOAD_DIR: uploads,
      });
      expect(fs.readFileSync(out, "utf8")).toBe(content);
      expect(calls).toBe(1);
    } finally {
      spy.mockRestore();
    }
  });

  it("rejects EMERGENCY_EXPORT_DIR configured as a public uploads alias", () => {
    const { emergency, uploads } = makeTempLayout();
    const exportLink = path.join(uploads, "export-link");
    fs.symlinkSync(emergency, exportLink);

    expect(() =>
      assertSafeEmergencyExportOut(path.join(emergency, "report.csv"), {
        EMERGENCY_EXPORT_DIR: exportLink,
        UPLOAD_DIR: uploads,
      }),
    ).toThrow(CliError);
  });

  it("rejects when EMERGENCY_EXPORT_DIR itself is under UPLOAD_DIR", () => {
    const { emergency, uploads } = makeTempLayout();
    const exportLink = path.join(uploads, "export-link");
    fs.symlinkSync(emergency, exportLink);

    expect(() =>
      assertSafeEmergencyExportOut(path.join(exportLink, "report.csv"), {
        EMERGENCY_EXPORT_DIR: exportLink,
        UPLOAD_DIR: uploads,
      }),
    ).toThrow(CliError);
  });
});
