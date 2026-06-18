-- Normalize legacy EventItem.config.size_field to contents[] (ADR 0025). Idempotent.

UPDATE "EventItem"
SET "config" = jsonb_set(
  "config" - 'size_field',
  '{contents}',
  jsonb_build_array(
    jsonb_build_object(
      'label', 'Shirt size',
      'source_field', "config"->>'size_field'
    )
  )
)
WHERE "config" ? 'size_field'
  AND NOT ("config" ? 'contents')
  AND ("config"->>'size_field') IS NOT NULL
  AND ("config"->>'size_field') <> '';

-- Non-returnable defaults: giftbag and badge (explicit false for operator transitions).
UPDATE "EventItem"
SET "config" = "config" || '{"requires_return":false}'::jsonb
WHERE "key" IN ('giftbag', 'badge')
  AND NOT ("config" ? 'requires_return');
