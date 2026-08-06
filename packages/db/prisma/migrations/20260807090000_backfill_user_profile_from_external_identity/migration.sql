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
-- Picks, per user, the most recently active linked identity (highest last_login_at) as the
-- backfill source - a user can have more than one ExternalIdentity row (multiple linked
-- providers).
WITH latest_identity AS (
  SELECT DISTINCT ON (user_id) user_id, name, phone
  FROM "ExternalIdentity"
  ORDER BY user_id, last_login_at DESC NULLS LAST, linked_at DESC
)
UPDATE "User" u
SET display_name = latest_identity.name
FROM latest_identity
WHERE latest_identity.user_id = u.id
  AND latest_identity.name IS NOT NULL
  AND u.display_name IS DISTINCT FROM latest_identity.name;

WITH latest_identity AS (
  SELECT DISTINCT ON (user_id) user_id, name, phone
  FROM "ExternalIdentity"
  ORDER BY user_id, last_login_at DESC NULLS LAST, linked_at DESC
)
UPDATE "User" u
SET phone_number = latest_identity.phone
FROM latest_identity
WHERE latest_identity.user_id = u.id
  AND latest_identity.phone IS NOT NULL
  AND u.phone_number IS DISTINCT FROM latest_identity.phone;
