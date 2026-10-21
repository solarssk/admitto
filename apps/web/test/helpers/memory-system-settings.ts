import { vi } from "vitest";

type KeyArgs = { where: { key: string } };
type UpsertArgs = KeyArgs & { create: { value_json: string }; update: { value_json: string } };

/**
 * The SystemSettings table in memory: the three calls the instance settings use, as `vi.fn`s. For
 * unit tests that hand a fake `db` to code that reads and writes one setting. `snapshot` and
 * `restore` let a fake `$transaction` roll back, the way a real one does when its callback throws.
 */
export function memorySystemSettings(initial: Record<string, string> = {}) {
  let rows = new Map<string, string>(Object.entries(initial));
  const systemSettings = {
    findUnique: vi.fn(async ({ where }: KeyArgs) =>
      rows.has(where.key) ? { key: where.key, value_json: rows.get(where.key)!, updated_at: new Date() } : null,
    ),
    upsert: vi.fn(async ({ where, create, update }: UpsertArgs) => {
      rows.set(where.key, rows.has(where.key) ? update.value_json : create.value_json);
    }),
    deleteMany: vi.fn(async ({ where }: KeyArgs) => ({ count: rows.delete(where.key) ? 1 : 0 })),
  };
  return {
    systemSettings,
    rows: () => rows,
    snapshot: () => new Map(rows),
    restore: (snapshot: Map<string, string>) => {
      rows = snapshot;
    },
  };
}
