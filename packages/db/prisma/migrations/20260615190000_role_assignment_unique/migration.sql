-- RBAC-2: dedup RoleAssignment rows, then partial UNIQUE indexes (instance NULL handled separately).
-- SEC-2: orphan OidcRoleGrant cleanup + FK to RoleAssignment with ON DELETE CASCADE.

-- 1. Dedup: keep oldest row per (user_id, role, scope_type, scope_id).
DELETE FROM "RoleAssignment" ra
WHERE ra."id" NOT IN (
  SELECT DISTINCT ON ("user_id", "role", "scope_type", "scope_id") "id"
  FROM "RoleAssignment"
  ORDER BY "user_id", "role", "scope_type", "scope_id", "created_at" ASC, "id" ASC
);

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
