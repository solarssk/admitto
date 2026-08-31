/** Shared shape for the Custom fields reports aggregate response, so the backend's reports route
 * (apps/web) and the admin frontend's own API types (apps/admin) don't carry two
 * independently-maintained copies of the same fields (same reasoning as eventWalletReportsDto.ts).
 * Dependency-free, so it's safe in the browser bundle.
 *
 * One entry per the event's own EventCustomField registry, in registry order (same order as the
 * Requirements page's own field list) - deliberately generic by `type` rather than special-cased
 * per field, since a field's meaning is admin-defined and can't be known ahead of time. `select`
 * and `boolean` fields chart as a category distribution (including an explicit "not answered"
 * bucket so percentages always sum to 100); `text` fields are free-form and don't bucket
 * meaningfully, so they only carry a fill-rate stat. */
export interface EventCustomFieldReportsResponse {
  total_attendees: number;
  fields: Array<{
    id: string;
    source_field: string;
    label: string;
    /** The field's own admin-entered description (EventCustomField.description) - the same text
     * shown on the Requirements page's field editor, verbatim (never a fallback string here; the
     * frontend decides how to display a null one). */
    description: string | null;
    type: "text" | "select" | "boolean";
    /** Present for `select`/`boolean` only - null for `text`. Ordered by count descending, with
     * a trailing "not answered" bucket (key: "__not_answered__") when any attendee lacks a value,
     * omitted entirely when everyone answered. */
    distribution: Array<{ key: string; label: string; count: number; pct: number }> | null;
    /** Present for `text` only - null for `select`/`boolean`. */
    response_rate: { answered: number; pct: number } | null;
  }>;
}

/** Sentinel bucket key for "no value set" in a `select`/`boolean` field's distribution - never a
 * real stored value, since `EventCustomField.source_field` slugs and `select` option text are
 * both admin-authored strings that can't collide with this reserved form. */
export const CUSTOM_FIELD_NOT_ANSWERED_KEY = "__not_answered__";
