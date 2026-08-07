-- One-time data fix for installs that were already running the pre-fix login code: it updated
-- ExternalIdentity.name/.phone on every login but never propagated the change to User, so on an
-- existing install ExternalIdentity may already be ahead of User for accounts whose IdP name/
-- phone changed after first login. resolveOrCreateUserFromExternalIdentity's own "was this
-- manually overridden" check (User.<field> vs ExternalIdentity.<field>) would otherwise read that
-- pre-existing drift as a manual admin edit and never repair it - these are exactly the stale
-- accounts the surrounding re-sync fix targets. Runs once, here, as a plain migration (not a
-- repeating db:migrate backfill script) so it never re-fires on a later deploy and clobbers a
-- genuine future manual edit made via the Edit user modal.
--
-- A raw value mismatch alone can't tell a genuine pre-existing manual edit (made before this
-- deploy, so ExternalIdentity was never touched to match it) apart from plain staleness - both
-- look identical as "User differs from ExternalIdentity" with no other data available. Real
-- provenance for that already exists: apps/web/src/admin/users-routes.ts's PATCH /users/:id
-- handler writes an AdminAuditLog row (action_type user_profile_updated / user_email_changed,
-- metadata.userId = the target) on every save of the Edit user modal - the modal always resends
-- display_name/email/phone in that save, so any such row is real historical evidence a superadmin
-- has touched this account's profile at least once, even for a save that didn't specifically
-- change display_name/phone. Excluding those users entirely is deliberately conservative: some
-- stale-but-never-actually-manually-edited accounts stay unrepaired by this one-time backfill
-- (they're still safe, and repair correctly on their own from here via the normal login sync -
-- once the account's own future login next changes at the IdP), but no genuine manual edit is
-- ever at risk of being silently overwritten.
--
-- Both fields are backfilled in a single UPDATE (rather than one per field) to avoid duplicating
-- the manually-touched-users exclusion and its literals.
--
-- Picks, per user, the most recently active linked identity (highest last_login_at) as the
-- backfill source - a user can have more than one ExternalIdentity row (multiple linked
-- providers).
WITH latest_identity AS (
  SELECT DISTINCT ON (user_id) user_id, name, phone
  FROM "ExternalIdentity"
  ORDER BY user_id, last_login_at DESC NULLS LAST, linked_at DESC
),
manually_touched_users AS (
  SELECT DISTINCT (metadata ->> 'userId') AS user_id
  FROM "AdminAuditLog"
  WHERE action_type IN ('user_profile_updated', 'user_email_changed')
    AND metadata ->> 'userId' IS NOT NULL
)
UPDATE "User" u
SET
  display_name = CASE
    WHEN latest_identity.name IS NOT NULL AND u.display_name IS DISTINCT FROM latest_identity.name
    THEN latest_identity.name
    ELSE u.display_name
  END,
  phone_number = CASE
    WHEN latest_identity.phone IS NOT NULL AND u.phone_number IS DISTINCT FROM latest_identity.phone
    THEN latest_identity.phone
    ELSE u.phone_number
  END
FROM latest_identity
WHERE latest_identity.user_id = u.id
  AND NOT EXISTS (SELECT 1 FROM manually_touched_users m WHERE m.user_id = u.id)
  AND (
    (latest_identity.name IS NOT NULL AND u.display_name IS DISTINCT FROM latest_identity.name)
    OR (latest_identity.phone IS NOT NULL AND u.phone_number IS DISTINCT FROM latest_identity.phone)
  );
