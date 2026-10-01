-- The admin/superadmin session lifetime was seeded as 7 days (20260614130000_2fa_totp) while the
-- built-in default has been 12 hours since the P0 security review, so the stored row hid that
-- default on every instance that ran the seed. Move a row that still holds the seeded value to the
-- 12 hour default; a lifetime set to anything else in Settings -> Security is left alone, and
-- nothing is inserted where there is no row. Sessions already issued keep their own end time.
UPDATE "SystemSettings"
SET "value_json" = '43200000', "updated_at" = NOW()
WHERE "key" = 'session_ttl' AND "value_json" = '604800000';
