import { describe, expect, it } from "vitest";
import { loadEnvFile, parseEnvValue } from "../src/loadDotEnv.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

describe("parseEnvValue", () => {
  it("strips unquoted inline comments", () => {
    expect(parseEnvValue("postgres://x # dev only")).toBe("postgres://x");
  });

  it("preserves hash inside quoted values", () => {
    expect(parseEnvValue('"secret#hash"')).toBe("secret#hash");
  });

  it("preserves equals in unquoted values", () => {
    expect(parseEnvValue("a=b=c")).toBe("a=b=c");
  });
});

describe("loadEnvFile", () => {
  it("loads keys without overwriting existing process.env entries", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "admitto-env-"));
    const envPath = path.join(dir, ".env");
    fs.writeFileSync(envPath, "ADMITTO_TEST_ENV_KEY=from_file\n");

    const key = "ADMITTO_TEST_ENV_KEY";
    const previous = process.env[key];
    delete process.env[key];

    try {
      loadEnvFile(envPath);
      expect(process.env[key]).toBe("from_file");
      process.env[key] = "preset";
      loadEnvFile(envPath);
      expect(process.env[key]).toBe("preset");
    } finally {
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
