-- Versions up to 0.7.5 marked a pass that was made under a Template ID the event no longer had as failed with
-- "wallet_credential_changed" and left the pass in the account it was made in. Erasing the person has to keep such a
-- row open (see "left_behind_pass_id" on "WalletPass"), so the rows that still carry the code get the mark too. Their
-- pass id was never recorded, hence "unknown". A row that has the mark already keeps its own value.
UPDATE "WalletPass"
SET "left_behind_pass_id" = 'unknown'
WHERE "last_error_code" = 'wallet_credential_changed' AND "left_behind_pass_id" IS NULL;
