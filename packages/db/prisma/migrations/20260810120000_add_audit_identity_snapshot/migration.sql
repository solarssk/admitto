-- Immutable staff identity snapshots on durable audit rows (v0.4.14).

ALTER TABLE "AdminAuditLog" ADD COLUMN "actor_email" TEXT;
ALTER TABLE "AdminAuditLog" ADD COLUMN "actor_display_name" TEXT;

ALTER TABLE "SecurityAuditLog" ADD COLUMN "user_email" TEXT;
ALTER TABLE "SecurityAuditLog" ADD COLUMN "user_display_name" TEXT;

-- Backfill from live User rows where they still exist.
UPDATE "AdminAuditLog" aal
SET actor_email = u.email,
    actor_display_name = u.display_name
FROM "User" u
WHERE aal.actor_user_id = u.id
  AND aal.actor_email IS NULL;

UPDATE "SecurityAuditLog" sal
SET user_email = u.email,
    user_display_name = u.display_name
FROM "User" u
WHERE sal.user_id = u.id
  AND sal.user_email IS NULL;

-- Legacy login-success rows stored email only in metadata.
UPDATE "SecurityAuditLog"
SET user_email = metadata->>'email'
WHERE user_id IS NOT NULL
  AND user_email IS NULL
  AND metadata->>'email' IS NOT NULL;
