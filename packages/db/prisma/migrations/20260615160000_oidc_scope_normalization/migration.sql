-- Normalize instance-scope RoleAssignment rows (CHECK requires scope_id IS NULL).

UPDATE "RoleAssignment"
SET "scope_id" = NULL
WHERE "scope_type" = 'instance'
  AND ("scope_id" = '' OR BTRIM("scope_id") = '');
