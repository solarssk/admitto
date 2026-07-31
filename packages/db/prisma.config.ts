import "dotenv/config";
import { defineConfig } from "prisma/config";

// Prisma ORM v7 no longer auto-loads .env files or accepts `datasource.url = env(...)` inside
// schema.prisma (P1012) — this file replaces both. `dotenv/config` restores the previous local-dev
// behavior of auto-loading packages/db/.env (CI and Docker set DATABASE_URL directly and don't need
// it). process.env.DATABASE_URL is used directly instead of the `env()` helper from "prisma/config":
// every Prisma CLI command loads this file, including `generate`, which doesn't need a live database
// connection and shouldn't hard-fail when DATABASE_URL happens to be unset.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: process.env.DATABASE_URL ?? "",
  },
});
