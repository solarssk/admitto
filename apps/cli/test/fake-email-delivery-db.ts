// In-memory stand-in for the slice of PrismaClient that `nullifyDeliverySnapshots` touches, so the
// CLI's retention entry points can run the real function without a database. It honors only the
// `lte` cutoff date of the selector, which is what these tests are about (which window the env
// override picks); the full selector is covered on a real database in
// packages/mail-delivery/test/retention.test.ts.

export const SNAPSHOT_RETENTION_ENV = "EMAIL_DELIVERY_SNAPSHOT_RETENTION_DAYS";

export interface FakeDelivery {
  id: string;
  sent_at: Date;
  created_at: Date;
  rendered_html: string | null;
  rendered_subject: string | null;
}

/** A row aged 75 days is kept by a 90 day window and cleared by the default 60 day one. */
export const SNAPSHOT_ENV_CASES = [
  { label: "set to 90", env: "90", days: 90, keepsBetween: true },
  { label: "unset", env: undefined, days: 60, keepsBetween: false },
];

function agedDelivery(id: string, days: number): FakeDelivery {
  return {
    id,
    sent_at: new Date(Date.now() - days * 24 * 60 * 60 * 1000),
    created_at: new Date(0),
    rendered_html: "<p>Hello Guest</p>",
    rendered_subject: "Your ticket",
  };
}

/** Sent 5, 75 and 100 days ago: inside both windows, between them, and outside both. */
export function seedAgedDeliveries() {
  return {
    recent: agedDelivery("recent", 5),
    between: agedDelivery("between-60-and-90-days", 75),
    old: agedDelivery("older-than-90-days", 100),
  };
}

function cutoffOf(where: unknown): Date {
  const found = new Set<number>();
  const walk = (node: unknown): void => {
    if (node === null || typeof node !== "object" || node instanceof Date) return;
    for (const [key, value] of Object.entries(node)) {
      if (key === "lte" && value instanceof Date) found.add(value.getTime());
      else walk(value);
    }
  };
  walk(where);
  const [ms] = found;
  if (found.size !== 1 || ms === undefined) {
    throw new Error(`expected exactly one cutoff date in the selector, found ${found.size}`);
  }
  return new Date(ms);
}

export function fakeEmailDeliveryDb(rows: FakeDelivery[]) {
  const stale = (where: unknown) => {
    const cutoff = cutoffOf(where);
    return rows.filter(
      (row) => (row.rendered_html !== null || row.rendered_subject !== null) && row.sent_at <= cutoff,
    );
  };
  return {
    // No contention in this fake; real advisory-lock behavior has database integration tests.
    $queryRaw: async (_strings: TemplateStringsArray, ids: { values: unknown[] }) =>
      rows.filter((row) => ids.values.includes(row.id)).map(({ id }) => ({ id })),
    emailDelivery: {
      count: async ({ where }: { where: unknown }) => stale(where).length,
      findMany: async ({ where, take }: { where: unknown; take: number }) =>
        stale(where)
          .slice(0, take)
          .map(({ id, created_at }) => ({ id, created_at })),
      updateMany: async ({
        where,
        data,
      }: {
        where: { AND: [unknown, { id: { in: string[] } }] };
        data: Record<string, unknown>;
      }) => {
        // The atomic write repeats the cutoff selector alongside the selected ids.
        if (!("rendered_html" in data)) return { count: 0 };
        const cleared = stale(where).filter((row) => where.AND[1].id.in.includes(row.id));
        for (const row of cleared) {
          row.rendered_html = null;
          row.rendered_subject = null;
        }
        return { count: cleared.length };
      },
    },
  };
}
