-- First-run bootstrap defence-in-depth: at most one instance-scoped superadmin row.
-- Complements Serializable + in-transaction user.count() guard in POST /setup.
CREATE UNIQUE INDEX "RoleAssignment_single_superadmin_key"
  ON "RoleAssignment" ("role", "scope_type")
  WHERE "scope_id" IS NULL AND "role" = 'superadmin';
