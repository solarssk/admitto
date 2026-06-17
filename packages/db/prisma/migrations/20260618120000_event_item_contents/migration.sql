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
  AND NOT ("config" ? 'contents');
