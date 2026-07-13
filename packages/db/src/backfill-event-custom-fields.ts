import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";

type LegacyContentRow = {
  label: string;
  source_field: string;
  type?: "text" | "select" | "boolean";
  required?: boolean;
  options?: string[];
};

function parseLegacyContents(config: unknown): LegacyContentRow[] {
  if (!config || typeof config !== "object" || Array.isArray(config)) return [];
  const contents = (config as { contents?: unknown }).contents;
  if (!Array.isArray(contents)) return [];
  const rows: LegacyContentRow[] = [];
  for (const raw of contents) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    if (typeof row.label !== "string" || typeof row.source_field !== "string") continue;
    const label = row.label.trim();
    const source_field = row.source_field.trim();
    if (!label || !source_field) continue;
    const entry: LegacyContentRow = { label, source_field };
    if (row.type === "text" || row.type === "select" || row.type === "boolean") {
      entry.type = row.type;
    }
    if (row.required === true) entry.required = true;
    if (Array.isArray(row.options)) {
      const options = row.options.filter((o): o is string => typeof o === "string" && o.trim() !== "");
      if (options.length > 0) entry.options = options;
    }
    rows.push(entry);
  }
  return rows;
}

/**
 * Idempotent backfill: an EventItem saved before the EventCustomField registry existed carries
 * its field definitions embedded in config.contents[]. This creates a registry row for each
 * source_field that doesn't already have one (first item processed per event wins on metadata -
 * a real conflict just means the loser's richer required/options detail is dropped, not that the
 * migration fails), then rewrites every legacy item's config to content_fields: string[] and
 * drops contents. Runs automatically after `npm run db:migrate`; safe to re-run manually - a
 * second run finds no items with `contents` left and does nothing.
 */
export async function backfillEventCustomFields(
  prisma: PrismaClient,
): Promise<{ itemsUpdated: number; fieldsCreated: number; conflicts: string[] }> {
  // No where-filter on config here: JSON-path filtering syntax is easy to get subtly wrong in a
  // way that would silently skip rows a migration needs to touch. parseLegacyContents below does
  // the real filtering in JS, which is easy to verify - this table is small enough that a full
  // scan costs nothing.
  const allItems = await prisma.eventItem.findMany({
    select: { id: true, event_id: true, config: true },
    orderBy: [{ event_id: "asc" }, { created_at: "asc" }, { id: "asc" }],
  });

  let itemsUpdated = 0;
  let fieldsCreated = 0;
  const conflicts: string[] = [];
  // Per event: source_fields that already have a registry row (pre-existing, or created earlier
  // in this same run) - just a membership check, no metadata needed. Separately, the legacy row
  // that *won* the registry slot for each source_field, kept only so a later item redefining the
  // same field with different metadata can be reported instead of silently dropped.
  const registeredByEvent = new Map<string, Set<string>>();
  const winnerByEvent = new Map<string, Map<string, LegacyContentRow>>();

  for (const item of allItems) {
    const rows = parseLegacyContents(item.config);
    if (rows.length === 0) continue;

    let registered = registeredByEvent.get(item.event_id);
    if (!registered) {
      const existing = await prisma.eventCustomField.findMany({
        where: { event_id: item.event_id },
        select: { source_field: true },
      });
      registered = new Set(existing.map((row) => row.source_field));
      registeredByEvent.set(item.event_id, registered);
      winnerByEvent.set(item.event_id, new Map());
    }
    const winners = winnerByEvent.get(item.event_id)!;

    const content_fields: string[] = [];
    for (const row of rows) {
      if (!content_fields.includes(row.source_field)) content_fields.push(row.source_field);

      if (registered.has(row.source_field)) {
        const winner = winners.get(row.source_field);
        if (winner) {
          const differs =
            winner.type !== row.type ||
            winner.required !== row.required ||
            JSON.stringify(winner.options) !== JSON.stringify(row.options);
          if (differs) {
            conflicts.push(
              `${item.event_id}/${row.source_field}: kept "${winner.label}" (${winner.type ?? "text"}), item ${item.id} also defined it as "${row.label}" (${row.type ?? "text"})`,
            );
          }
        }
        continue;
      }

      registered.add(row.source_field);
      winners.set(row.source_field, row);
      await prisma.eventCustomField.create({
        data: {
          event_id: item.event_id,
          source_field: row.source_field,
          label: row.label,
          type: row.type ?? "text",
          required: row.required ?? false,
          options: row.options ?? Prisma.JsonNull,
        },
      });
      fieldsCreated += 1;
    }

    const nextConfig = { ...(item.config as Record<string, unknown>) };
    delete nextConfig.contents;
    nextConfig.content_fields = content_fields;
    await prisma.eventItem.update({
      where: { id: item.id },
      data: { config: nextConfig as Prisma.InputJsonValue },
    });
    itemsUpdated += 1;
  }

  return { itemsUpdated, fieldsCreated, conflicts };
}
