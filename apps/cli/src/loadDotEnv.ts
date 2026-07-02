import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Load key=value lines from a .env file (no expansion). */
function loadEnvFile(envPath: string): void {
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

export function loadDotEnv(): void {
  const monorepoRoot = path.join(__dirname, "..", "..", "..");
  const candidates = [
    path.join(monorepoRoot, ".env"),
    path.join(monorepoRoot, "packages", "db", ".env"),
    path.join(monorepoRoot, "deploy", ".env"),
  ];
  for (const envPath of candidates) {
    loadEnvFile(envPath);
  }
}
