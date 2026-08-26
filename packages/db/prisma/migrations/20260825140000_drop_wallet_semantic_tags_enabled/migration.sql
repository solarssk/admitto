-- Confirmed dead: PassCreator's POST /api/v3/pass has no documented `semantics` field, and
-- empirical testing (real issued pass.json before/after clearing template bindings) showed
-- Admitto's `data.semantics` payload never reached the output pass. This toggle never delivered
-- the "Siri Suggestions, Maps, Calendar" behavior its own copy promised. Replaced by mapping
-- individual fields (event type, venue room/entrance/phone/place ID, access-point timing) through
-- the existing Field mapping mechanism, same as every other wallet placeholder.
ALTER TABLE "Event" DROP COLUMN "wallet_semantic_tags_enabled";
