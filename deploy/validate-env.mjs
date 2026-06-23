#!/usr/bin/env node
/**
 * Pre-flight checks for deploy/.env before `docker compose up`.
 * Run from deploy/: node validate-env.mjs [.env]
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const PLACEHOLDERS = new Set(["CHANGE_ME", "changeme", ""]);
const MIN_REDIS_PASSWORD_LEN = 16;
const MIN_POSTGRES_PASSWORD_LEN = 16;

function loadEnvFile(filePath) {
  const env = {};
  const content = readFileSync(filePath, "utf8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    env[key] = val;
  }
  return env;
}

function fail(message) {
  console.error(`validate-env: error: ${message}`);
  process.exit(1);
}

function warn(message) {
  console.warn(`validate-env: warning: ${message}`);
}

function isPlaceholder(value) {
  return value == null || PLACEHOLDERS.has(value.trim());
}

function requireSecret(name, value, minLen) {
  if (isPlaceholder(value)) {
    fail(`${name} is missing or still set to CHANGE_ME — edit deploy/.env`);
  }
  if (value.trim().length < minLen) {
    fail(`${name} must be at least ${minLen} characters`);
  }
}

function validateBaseUrl(env) {
  const nodeEnv = env.NODE_ENV ?? "production";
  const raw = env.BASE_URL?.trim();
  if (!raw) {
    if (nodeEnv !== "development") {
      fail("BASE_URL is required (e.g. https://tickets.example.com)");
    }
    return;
  }
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    fail("BASE_URL must be a valid http:// or https:// URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    fail("BASE_URL must use http:// or https://");
  }
  if (nodeEnv !== "development" && parsed.protocol === "http:") {
    const host = parsed.hostname;
    if (host !== "localhost" && host !== "127.0.0.1") {
      fail("BASE_URL must use https:// in production (http://127.0.0.1 is allowed for local smoke only)");
    }
  }
}

function validateEncryptionKey(value) {
  requireSecret("ENCRYPTION_KEY", value, 44);
  let buf;
  try {
    buf = Buffer.from(value.trim(), "base64");
  } catch {
    fail("ENCRYPTION_KEY must be valid base64 (generate: openssl rand -base64 32)");
  }
  if (buf.length !== 32) {
    fail("ENCRYPTION_KEY must decode to 32 bytes (generate: openssl rand -base64 32)");
  }
}

function validateDatabaseUrl(env) {
  const dbUrl = env.DATABASE_URL?.trim();
  if (!dbUrl) {
    fail("DATABASE_URL is required");
  }
  let parsed;
  try {
    parsed = new URL(dbUrl);
  } catch {
    fail("DATABASE_URL must be a valid PostgreSQL URL");
  }
  if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") {
    fail("DATABASE_URL must use postgresql://");
  }
  const pgPass = env.POSTGRES_PASSWORD?.trim();
  const urlPass = decodeURIComponent(parsed.password);
  if (pgPass && urlPass && pgPass !== urlPass) {
    fail(
      "DATABASE_URL password does not match POSTGRES_PASSWORD — keep them in sync (see deploy/.env.example)",
    );
  }
}

function validateRedisUrl(env) {
  const redisPassword = env.REDIS_PASSWORD?.trim();
  requireSecret("REDIS_PASSWORD", redisPassword, MIN_REDIS_PASSWORD_LEN);

  const redisUrl = env.REDIS_URL?.trim();
  if (!redisUrl) {
    warn(
      "REDIS_URL is unset in .env — docker compose sets redis://:${REDIS_PASSWORD}@redis:6379 on the app service",
    );
    return;
  }
  let parsed;
  try {
    parsed = new URL(redisUrl);
  } catch {
    fail("REDIS_URL must be a valid Redis URL");
  }
  const urlPass = decodeURIComponent(parsed.password);
  if (!urlPass) {
    warn(
      "REDIS_URL has no password — compose overrides app REDIS_URL from REDIS_PASSWORD; ensure REDIS_PASSWORD is set",
    );
    return;
  }
  if (redisPassword && urlPass !== redisPassword) {
    warn(
      "REDIS_URL password differs from REDIS_PASSWORD — compose overrides app REDIS_URL; only REDIS_PASSWORD matters at runtime",
    );
  }
}

const envFile = resolve(process.argv[2] ?? ".env");
if (!existsSync(envFile)) {
  fail(`env file not found: ${envFile} (copy .env.example to .env first)`);
}

const env = loadEnvFile(envFile);

requireSecret("POSTGRES_PASSWORD", env.POSTGRES_PASSWORD, MIN_POSTGRES_PASSWORD_LEN);
validateEncryptionKey(env.ENCRYPTION_KEY);
validateBaseUrl(env);
validateDatabaseUrl(env);
validateRedisUrl(env);

console.log(`validate-env: ok (${envFile})`);
