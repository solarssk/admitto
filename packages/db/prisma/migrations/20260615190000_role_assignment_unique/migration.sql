-- RBAC-2: dedup RoleAssignment rows, then partial UNIQUE indexes (instance NULL handled separately).
-- SEC-2: orphan OidcRoleGrant cleanup + FK to RoleAssignment with ON DELETE CASCADE.
--
-- Atomicity: Prisma Migrate applies each PostgreSQL migration inside a single DB transaction.
-- Explicit BEGIN/COMMIT is omitted here to avoid nested-transaction errors with Prisma's wrapper.

-- 0. Before deleting duplicate assignments, repoint OidcRoleGrant rows to the survivor
-- (oldest row per user/role/scope). Otherwise orphan cleanup would drop the grant and the
-- surviving assignment would look manual — OIDC demotion would no longer revoke the role.
WITH ranked AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "user_id", "role", "scope_type", "scope_id"
      ORDER BY "created_at" ASC, "id" ASC
    ) AS rn,
    FIRST_VALUE("id") OVER (
      PARTITION BY "user_id", "role", "scope_type", "scope_id"
      ORDER BY "created_at" ASC, "id" ASC
    ) AS survivor_id
  FROM "RoleAssignment"
)
UPDATE "OidcRoleGrant" g
SET "role_assignment_id" = ranked.survivor_id
FROM ranked
WHERE g."role_assignment_id" = ranked."id"
  AND ranked.rn > 1;

-- 1. Dedup: delete duplicate assignments (grants already repointed above).
-- ROW_NUMBER handles NULL scope_id in PARTITION BY (NULLs group together); avoids NOT IN edge cases.
DELETE FROM "RoleAssignment" ra
USING (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "user_id", "role", "scope_type", "scope_id"
      ORDER BY "created_at" ASC, "id" ASC
    ) AS rn
  FROM "RoleAssignment"
) dups
WHERE ra."id" = dups."id"
  AND dups.rn > 1;

-- 2. Partial UNIQUE indexes (Postgres treats NULL scope_id as distinct in standard UNIQUE).
CREATE UNIQUE INDEX "RoleAssignment_user_role_scope_scoped_key"
  ON "RoleAssignment" ("user_id", "role", "scope_type", "scope_id")
  WHERE "scope_id" IS NOT NULL;

CREATE UNIQUE INDEX "RoleAssignment_user_role_scope_instance_key"
  ON "RoleAssignment" ("user_id", "role", "scope_type")
  WHERE "scope_id" IS NULL;

-- 3. Remove orphan grants before FK.
DELETE FROM "OidcRoleGrant" g
WHERE NOT EXISTS (
  SELECT 1 FROM "RoleAssignment" ra WHERE ra."id" = g."role_assignment_id"
);

-- 4. FK: grant must reference a real assignment; cascade delete grant when assignment removed.
ALTER TABLE "OidcRoleGrant"
  ADD CONSTRAINT "OidcRoleGrant_role_assignment_id_fkey"
  FOREIGN KEY ("role_assignment_id") REFERENCES "RoleAssignment"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
