#!/usr/bin/env node
/**
 * Auth CLI — bootstrap local superadmin (break-glass).
 *
 *   npm run cli -w @admitto/auth -- bootstrap-superadmin --email admin@example.com
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { prisma } from "@admitto/db";
import { bootstrapSuperadmin, superadminInstanceExists } from "./bootstrap.js";
import { loadEnvFile } from "./loadDotEnv.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadDotEnv(): void {
  const monorepoRoot = path.join(__dirname, "..", "..", "..");
  const candidates = [
    path.join(monorepoRoot, ".env"),
    path.join(monorepoRoot, "packages", "db", ".env"),
    path.join(__dirname, "..", ".env"),
  ];
  for (const envPath of candidates) {
    loadEnvFile(envPath);
  }
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function usage(): never {
  console.error(
    "Usage: npm run cli -w @admitto/auth -- bootstrap-superadmin --email <email> [--force]",
  );
  process.exit(1);
}

async function readPasswordFromStdin(): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve, reject) => {
    rl.question("Password: ", (answer) => {
      rl.close();
      if (!answer) {
        reject(new Error("Password required"));
        return;
      }
      resolve(answer);
    });
    rl.on("close", () => {});
  });
}

async function confirmForce(): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) => {
    rl.question(
      "A superadmin@instance already exists. Type 'yes' to create another: ",
      (answer) => {
        rl.close();
        resolve(answer.trim().toLowerCase() === "yes");
      },
    );
  });
}

async function runBootstrapSuperadmin(): Promise<void> {
  const email = arg("email");
  if (!email) usage();

  const force = hasFlag("force");
  const exists = await superadminInstanceExists(prisma);
  if (exists && !force) {
    console.error(
      "superadmin@instance already exists. Use --force to create another (with confirmation).",
    );
    process.exit(1);
  }
  if (exists && force) {
    const ok = await confirmForce();
    if (!ok) {
      console.error("Aborted.");
      process.exit(1);
    }
  }

  let password: string;
  try {
    password = await readPasswordFromStdin();
  } catch (err) {
    console.error(err instanceof Error ? err.message : "Password read failed");
    process.exit(1);
  }

  const { userId } = await bootstrapSuperadmin(prisma, email, password);
  console.log(`Superadmin created: ${userId} (${email})`);
}

async function main(): Promise<void> {
  loadDotEnv();

  if (!process.env["DATABASE_URL"]) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }

  const sub = process.argv[2];
  if (sub === "bootstrap-superadmin") {
    try {
      await runBootstrapSuperadmin();
    } finally {
      await prisma.$disconnect();
    }
    return;
  }

  usage();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
