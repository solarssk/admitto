import type { ReactNode } from "react";
import {
  Button,
  Card,
  EmptyState,
  HintLabel,
  Input,
  Notice,
  StatusBadge,
  Switch,
  Tooltip,
} from "@admitto/ui";
import { WALLET_MAPPING_PLACEHOLDERS } from "@admitto/wallet/passcreator-mapper";
import { formatEventHoursRange } from "@admitto/shared/region-date-format";
import { isMapReady, resolveAppleMapsUrl, resolveGoogleMapsUrl } from "@admitto/location";
import type { WalletPushHistoryEntry, WalletPushHistoryScope } from "../api/client.js";
import type { EventLocationDto, EventSettingsDto } from "../api/types.js";
import { PaginationFooter } from "../components/PaginationFooter.js";
import { SearchableSelect } from "../components/SearchableSelect.js";
import { SamsungWalletIcon } from "../components/SamsungWalletIcon.js";
import type { EventSettingsFormPanelProps, SettingsForm } from "../pages/EventSettingsPage.js";
import {
  formatUtcDateTime,
  formatWalletDatePreview,
  formatWalletDatePreviewShort,
  formatZonedClockTime,
} from "../utils/event-dates.js";
import { EVENT_TYPE_LABELS } from "./eventTypeOptions.js";
import { NO_AUTOFILL_PROPS, SecretFieldRow, SettingsFooter } from "./mailTransportFormParts.js";
import {
  computeWalletFieldMappingErrors,
  sortWalletFieldMappingByCategory,
  WALLET_PLACEHOLDER_OPTIONS,
  type WalletFieldMappingRow,
} from "./walletFieldMapping.js";

const WALLET_CARD_HINT = "Per-event Apple/Google Wallet pass configuration.";
const WALLET_CARD_INTRO =
  "Lets attendees add their ticket to Apple Wallet or Google Wallet. The API key and template are specific to this event, nothing is shared with other events.";
const WALLET_PROVIDER_HINT = "PassCreator is the only supported wallet pass provider today.";
const WALLET_TEMPLATE_HINT = "Which pass design this event's attendees get.";
const WALLET_API_KEY_HINT = "From the PassCreator dashboard, under API Keys.";
const WALLET_FIELD_MAPPING_HEADER_DESC =
  "Add every field your template's Additional Properties expect. Nothing beyond the QR code is sent to PassCreator until it's mapped here.";
const WALLET_FIELD_MAPPING_EMPTY_NOTICE =
  "No fields mapped yet - only the QR code is sent to PassCreator. Add a field for each value your template should show (name, event date, ticket type, and so on).";
const WALLET_FIELD_MAPPING_SEMANTIC_TAGS_NOTICE =
  "Mapping a field here sends its value to PassCreator, but Siri Suggestions, Maps, and Calendar smart data also needs that value bound in PassCreator's own Semantic Tags panel to a matching {CustomFieldName} placeholder - mapping alone is not enough.";

/** Placeholders whose real value depends on which attendee gets the pass, not on the event alone
 * - there's no single "value for this event" to preview on this page. */
const WALLET_ATTENDEE_SCOPED_HINTS: Partial<Record<(typeof WALLET_MAPPING_PLACEHOLDERS)[number], string>> = {
  full_name: "e.g. Jan Kowalski",
  first_name: "e.g. Jan",
  last_name: "e.g. Kowalski",
  email: "e.g. jan.kowalski@example.com",
  company: "e.g. Acme Sp. z o.o.",
  department: "e.g. Marketing",
  ticket_type: "e.g. VIP",
  ticket_url: "e.g. 8f14e45fceea167a5a36",
};

const WALLET_VALUE_NOT_SET = "Not set for this event - this field won't be sent.";

/** event_hours preview - country deliberately not threaded through (same as
 * formatWalletDatePreview above), so this stays exact for events with no address, an
 * unrecognized country, or a UK one; the real pass can differ in 12h/24h style for other
 * countries. Uses the real formatter, so the open-ended "from"/"until" wording and the timezone
 * abbreviation still match the actual pass exactly. */
function computeWalletEventHoursPreview(
  form: Pick<SettingsForm, "date" | "eventHoursStart" | "eventHoursEnd" | "timezone">,
): string {
  const range = formatEventHoursRange(
    form.eventHoursStart || null,
    form.eventHoursEnd || null,
    null,
    form.timezone,
    new Date(`${form.date}T12:00:00.000Z`),
  );
  if (!range) return WALLET_VALUE_NOT_SET;
  return range.tzAbbr ? `${range.hours} ${range.tzAbbr}` : range.hours;
}

/** Location-sourced placeholder previews - split out of computeWalletPlaceholderPreview to keep
 * its own cognitive complexity down (SonarCloud S3776). Only reached once `location` has loaded
 * (the caller handles the `undefined` "still loading" case first). */
function computeWalletLocationPlaceholderPreview(
  id: (typeof WALLET_MAPPING_PLACEHOLDERS)[number],
  location: EventLocationDto | null,
): string {
  switch (id) {
    case "event_location":
      return location?.venue_name || WALLET_VALUE_NOT_SET;
    case "directions_text":
      return location?.directions_text || WALLET_VALUE_NOT_SET;
    case "accessibility_text":
      return location?.accessibility_text || WALLET_VALUE_NOT_SET;
    case "google_maps_url":
    case "apple_maps_url": {
      if (!location || !isMapReady(location)) return WALLET_VALUE_NOT_SET;
      const label = location.venue_name ?? location.formatted_address ?? undefined;
      return id === "google_maps_url"
        ? resolveGoogleMapsUrl(location.latitude!, location.longitude!, label, location.google_maps_url_override)
        : resolveAppleMapsUrl(location.latitude!, location.longitude!, label, location.apple_maps_url_override);
    }
    case "object_name":
    case "street":
    case "postcode":
    case "city":
    case "region":
    case "country":
      return location?.address_components?.[id] || WALLET_VALUE_NOT_SET;
    case "venue_room":
      return location?.venue_room || WALLET_VALUE_NOT_SET;
    case "venue_entrance":
      return location?.venue_entrance || WALLET_VALUE_NOT_SET;
    case "venue_entrance_door":
      return location?.venue_entrance_door || WALLET_VALUE_NOT_SET;
    case "venue_entrance_gate":
      return location?.venue_entrance_gate || WALLET_VALUE_NOT_SET;
    case "venue_entrance_portal":
      return location?.venue_entrance_portal || WALLET_VALUE_NOT_SET;
    case "venue_phone_number":
      return location?.venue_phone_number || WALLET_VALUE_NOT_SET;
    case "venue_place_id":
      return location?.venue_place_id || WALLET_VALUE_NOT_SET;
    // Timing fields show the raw "HH:MM" value directly rather than the full zoned ISO instant
    // buildWalletPassInput computes server-side - this preview's job is "does this event have a
    // value," not a byte-exact wire-format match, avoiding re-implementing zonedWallClockToUtcIso
    // client-side.
    case "venue_open_time":
      return location?.venue_open_time || WALLET_VALUE_NOT_SET;
    case "venue_close_time":
      return location?.venue_close_time || WALLET_VALUE_NOT_SET;
    case "doors_open_time":
      return location?.doors_open_time || WALLET_VALUE_NOT_SET;
    case "gates_open_time":
      return location?.gates_open_time || WALLET_VALUE_NOT_SET;
    case "box_office_open_time":
      return location?.box_office_open_time || WALLET_VALUE_NOT_SET;
    case "parking_lots_open_time":
      return location?.parking_lots_open_time || WALLET_VALUE_NOT_SET;
    case "fan_zone_open_time":
      return location?.fan_zone_open_time || WALLET_VALUE_NOT_SET;
    default:
      return WALLET_VALUE_NOT_SET;
  }
}

/** The real value a field mapping row's hint icon shows on hover - what this specific event
 * would actually send for the selected placeholder right now (apps/web/src/app.ts's own
 * buildWalletPassInput), not a generic description of the field. `location` is `undefined` while
 * still loading (see the effect that fetches it), `null` once loaded with nothing saved. */
function computeWalletPlaceholderPreview(
  id: (typeof WALLET_MAPPING_PLACEHOLDERS)[number],
  form: Pick<SettingsForm, "title" | "date" | "eventHoursStart" | "eventHoursEnd" | "timezone" | "eventType">,
  location: EventLocationDto | null | undefined,
): string {
  const attendeeHint = WALLET_ATTENDEE_SCOPED_HINTS[id];
  if (attendeeHint) return attendeeHint;
  if (id === "event_name") return form.title;
  if (id === "event_date") return formatWalletDatePreview(form.date) ?? WALLET_VALUE_NOT_SET;
  if (id === "event_date_short") return formatWalletDatePreviewShort(form.date) ?? WALLET_VALUE_NOT_SET;
  if (id === "event_hours") return computeWalletEventHoursPreview(form);
  if (id === "event_type") return form.eventType ? EVENT_TYPE_LABELS[form.eventType] : WALLET_VALUE_NOT_SET;
  if (location === undefined) return "Loading…";
  return computeWalletLocationPlaceholderPreview(id, location);
}

const WALLET_PUSH_HISTORY_PAGE_SIZE_OPTIONS = [10, 25, 50] as const;
export const WALLET_PUSH_HISTORY_PAGE_SIZE_DEFAULT = 10;

/** This is when the push job ran on the server, not an event-schedule fact - always UTC-primary
 * with the triggering admin's own local time underneath, same as Delivery log's "Sent / Queued"
 * column. Deliberately not event-timezone: an admin in one timezone triggering a push for an
 * event venue in another would otherwise see neither their own clock nor a real operational
 * instant, just a third, unrelated time. */
const WALLET_PUSH_HISTORY_TIME_HINT =
  "Top: when this ran, in UTC. Below: the same moment in the local time of whoever's browser triggered it, when known.";

interface WalletPushHistoryCardProps {
  readonly history: WalletPushHistoryEntry[] | null;
  readonly total: number;
  readonly error: string | null;
  readonly onRetry: () => void;
  readonly showLoading: boolean;
  readonly page: number;
  readonly pageSize: number;
  readonly onPageChange: (page: number) => void;
  readonly onPageSizeChange: (pageSize: number) => void;
}

/** "3 attendees", "Whole event · location update" - the scope column's text. `null` (a job from
 * before this field existed) reads as an em-dash rather than a blank cell, so it's visibly "we
 * don't know" and not confused with a genuinely-scopeless push. */
function describeWalletPushScope(scope: WalletPushHistoryScope | null): string {
  if (!scope) return "—";
  if (scope.kind === "attendee_ids") {
    return `${scope.count} ${scope.count === 1 ? "attendee" : "attendees"}`;
  }
  if (scope.reason === "location") return "Whole event · location update";
  if (scope.reason === "settings") return "Whole event · settings update";
  if (scope.reason === "manual") return "Whole event · manual push";
  return "Whole event";
}

/** Recent wallet_push jobs for this event, from the async job system's own triggers (bulk
 * ticket-type change, or an event settings/location save that touches a wallet-relevant field).
 * Single-attendee field edits push directly and don't create a job, so they never appear here.
 * This is the automatic *data* refresh (name/ticket type/venue/etc. already on an issued pass) -
 * not the same thing as a custom text message, which is Communication > Wallets > Send, and has
 * its own separate history there. */
function WalletPushHistoryCard({
  history,
  total,
  error,
  onRetry,
  showLoading,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
}: WalletPushHistoryCardProps) {
  let body: ReactNode;
  if (error) {
    body = (
      <EmptyState
        title="Could not load wallet push history"
        description={error}
        action={
          <Button type="button" variant="secondary" onClick={onRetry}>
            Retry
          </Button>
        }
      />
    );
  } else if (history === null) {
    // settings-card-intro (already scoped to this page's own CSS) matches ImportHistoryCard's
    // muted-hint look without importing ImportPage's page-scoped import.css into this lazy chunk
    // (bot review - a component's CSS must live in its own file, per AGENTS.md's compounding
    // rules). wallet-push-history-card__body-note adds the padding .sessions-table-wrap used to
    // give this card for free, now that the Card itself is unpadded (see below).
    body = showLoading ? (
      <p className="settings-card-intro wallet-push-history-card__body-note">Loading…</p>
    ) : null;
  } else if (history.length === 0) {
    body = (
      <EmptyState
        icon={<i className="ti ti-history" aria-hidden="true" />}
        title="No wallet pushes yet"
        description="Pushes appear here after a bulk wallet push for this event, such as a ticket-type change."
      />
    );
  } else {
    body = (
      <div className="wallet-push-history-table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>
                <HintLabel hint={WALLET_PUSH_HISTORY_TIME_HINT}>Date</HintLabel>
              </th>
              <th>Status</th>
              <th>Scope</th>
              <th>Updated</th>
              <th>Skipped</th>
              <th>Errored</th>
            </tr>
          </thead>
          <tbody>
            {history.map((entry) => (
              <tr key={entry.id}>
                <td>
                  {formatUtcDateTime(entry.created_at)}
                  {entry.client_timezone && (
                    <div className="sessions-subdued">
                      {formatZonedClockTime(entry.created_at, entry.client_timezone)}
                    </div>
                  )}
                </td>
                <td>
                  <StatusBadge status={entry.status} />
                  {entry.status === "failed" && entry.error && (
                    <div style={{ color: "var(--text-muted)" }}>{entry.error}</div>
                  )}
                </td>
                <td>{describeWalletPushScope(entry.scope)}</td>
                <td>{entry.reissued}</td>
                <td>{entry.skipped}</td>
                <td>{entry.errored}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);

  return (
    <Card title="Wallet push history" className="event-settings-card wallet-push-history-card" padded={false}>
      <p className="settings-card-intro wallet-push-history-card__intro">
        Automatic pushes that refresh data (name, ticket type, venue, etc.) already on an
        attendee's issued wallet pass, triggered by a bulk ticket-type change or a wallet-relevant
        event settings/location save. Not a custom message - send those from Communication &gt;
        Wallets.
      </p>
      {body}
      {total > 0 && (
        <div className="wallet-push-history-card__footer">
          <PaginationFooter
            idPrefix="wallet-push-history"
            page={safePage}
            pageSize={pageSize}
            totalPages={totalPages}
            totalRows={total}
            pageSizeOptions={WALLET_PUSH_HISTORY_PAGE_SIZE_OPTIONS}
            onPageSizeChange={(size) => {
              onPageSizeChange(size);
              onPageChange(1);
            }}
            onPrevious={() => onPageChange(Math.max(1, safePage - 1))}
            onNext={() => onPageChange(safePage + 1)}
          />
        </div>
      )}
    </Card>
  );
}

/** Wallet tab: per-event PassCreator configuration (provider/API key/template, platform
 * toggles, field mapping) plus the push history card. `walletLocationPreview` is fetched and
 * owned by the parent (the Location tab's save handler invalidates it too, so ownership can't
 * move here); `walletTesting` and the wallet push history slice stay parent-owned as well (the
 * "safe default" from the extraction analysis) and are passed down as plain props/callbacks. */
export function EventWalletPanel({
  event,
  form,
  setForm,
  isArchived,
  saving,
  dirty,
  validationErrorsRef,
  onReset,
  onSave,
  walletTesting,
  onTestWallet,
  walletLocationPreview,
  walletPushHistory,
  walletPushHistoryTotal,
  walletPushHistoryError,
  onRetryWalletPushHistory,
  showWalletPushHistoryLoading,
  walletPushHistoryPage,
  walletPushHistoryPageSize,
  onWalletPushHistoryPageChange,
  onWalletPushHistoryPageSizeChange,
}: Readonly<
  EventSettingsFormPanelProps & {
    event: EventSettingsDto;
    walletTesting: boolean;
    onTestWallet: () => void;
    walletLocationPreview: EventLocationDto | null | undefined;
    walletPushHistory: WalletPushHistoryEntry[] | null;
    walletPushHistoryTotal: number;
    walletPushHistoryError: string | null;
    onRetryWalletPushHistory: () => void;
    showWalletPushHistoryLoading: boolean;
    walletPushHistoryPage: number;
    walletPushHistoryPageSize: number;
    onWalletPushHistoryPageChange: (page: number) => void;
    onWalletPushHistoryPageSizeChange: (pageSize: number) => void;
  }
>) {
  return (
    <>
      <Card
        title={<HintLabel hint={WALLET_CARD_HINT}>Wallet</HintLabel>}
        className="event-settings-card"
        actions={
          <Switch
            id="event-wallet-enabled"
            label={form.walletEnabled ? "On" : "Off"}
            checked={form.walletEnabled}
            disabled={isArchived || saving}
            onChange={(e) => setForm({ ...form, walletEnabled: e.target.checked })}
          />
        }
      >
        <div className="settings-card-stack">
          <p className="settings-card-intro">{WALLET_CARD_INTRO}</p>
          <div className="mail-transport-section">
            <div className="mail-field-row">
              <div className="at-field">
                <span className="at-label">
                  <HintLabel hint={WALLET_PROVIDER_HINT}>Provider</HintLabel>
                </span>
                <div className="external-provider-and-test">
                  <SearchableSelect
                    id="event-wallet-provider"
                    label="Provider"
                    placeholder="Select provider…"
                    searchPlaceholder="Search providers…"
                    emptyLabel="No providers found"
                    showLabel={false}
                    value="passcreator"
                    options={[{ id: "passcreator", label: "PassCreator" }]}
                    disabled
                    onChange={() => {}}
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={isArchived || walletTesting || saving || !form.walletTemplateId.trim()}
                    onClick={onTestWallet}
                    icon={<i className="ti ti-plug" aria-hidden="true" />}
                  >
                    {walletTesting ? "Testing…" : "Test connection"}
                  </Button>
                </div>
              </div>
            </div>
            <SecretFieldRow
              id="event-wallet-api-key"
              label="API key"
              hint={WALLET_API_KEY_HINT}
              field={{
                set: event?.wallet_api_key?.configured ?? false,
                masked: event?.wallet_api_key?.configured ? "••••" : null,
                source: "db",
                locked: false,
              }}
              edit={form.walletApiKeyEdit}
              disabled={isArchived || saving}
              onReplace={() => setForm({ ...form, walletApiKeyEdit: { mode: "replace", value: "" } })}
              onClear={() => setForm({ ...form, walletApiKeyEdit: { mode: "clear", value: "" } })}
              onValueChange={(value) => setForm({ ...form, walletApiKeyEdit: { mode: "replace", value } })}
              onCancel={() => setForm({ ...form, walletApiKeyEdit: { mode: "idle", value: "" } })}
            />
            <Input
              id="event-wallet-template-id"
              label="Template ID"
              value={form.walletTemplateId}
              disabled={isArchived || saving}
              placeholder="e.g. aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
              hint={WALLET_TEMPLATE_HINT}
              {...NO_AUTOFILL_PROPS}
              onChange={(e) => setForm({ ...form, walletTemplateId: e.target.value })}
            />
          </div>
          <div className="smtp-connection-tls-pair">
            <div className="settings-row smtp-connection-tls-row wallet-platform-row">
              <span className="wallet-platform-row__icon">
                <i className="ti ti-brand-apple" aria-hidden="true" />
              </span>
              <div className="settings-row__text">
                <strong>Apple Wallet</strong>
                <p>Shows the Add to Apple Wallet button on this event's tickets.</p>
              </div>
              <Switch
                id="event-wallet-apple-enabled"
                aria-label="Apple Wallet"
                checked={form.walletAppleEnabled}
                disabled={isArchived || saving}
                onChange={(e) => setForm({ ...form, walletAppleEnabled: e.target.checked })}
              />
            </div>
            <div className="settings-row smtp-connection-tls-row wallet-platform-row">
              <span className="wallet-platform-row__icon">
                <i className="ti ti-brand-google" aria-hidden="true" />
              </span>
              <div className="settings-row__text">
                <strong>Google Wallet</strong>
                <p>Shows the Add to Google Wallet button on this event's tickets.</p>
              </div>
              <Switch
                id="event-wallet-google-enabled"
                aria-label="Google Wallet"
                checked={form.walletGoogleEnabled}
                disabled={isArchived || saving}
                onChange={(e) => setForm({ ...form, walletGoogleEnabled: e.target.checked })}
              />
            </div>
            <div className="settings-row smtp-connection-tls-row wallet-platform-row">
              <span className="wallet-platform-row__icon">
                <SamsungWalletIcon />
              </span>
              <div className="settings-row__text">
                <strong>Samsung Wallet</strong>
                <p>Shows the Add to Samsung Wallet button on this event's tickets.</p>
              </div>
              <Switch
                id="event-wallet-samsung-enabled"
                aria-label="Samsung Wallet"
                checked={form.walletSamsungEnabled}
                disabled={isArchived || saving}
                onChange={(e) => setForm({ ...form, walletSamsungEnabled: e.target.checked })}
              />
            </div>
          </div>
          <div className="wallet-field-mapping">
            <Notice variant="info">{WALLET_FIELD_MAPPING_SEMANTIC_TAGS_NOTICE}</Notice>
            <div className="settings-row wallet-field-mapping__header">
              <div className="settings-row__text">
                <strong>Field mapping</strong>
                <p>{WALLET_FIELD_MAPPING_HEADER_DESC}</p>
              </div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={isArchived || saving}
                onClick={() =>
                  setForm({
                    ...form,
                    walletFieldMapping: [
                      ...form.walletFieldMapping,
                      { id: crypto.randomUUID(), key: "", value: "" },
                    ],
                  })
                }
              >
                Add field
              </Button>
            </div>
            {form.walletFieldMapping.length === 0 && (
              <Notice variant="warning">{WALLET_FIELD_MAPPING_EMPTY_NOTICE}</Notice>
            )}
            {form.walletFieldMapping.length > 0 &&
              sortWalletFieldMappingByCategory(form.walletFieldMapping).map((row: WalletFieldMappingRow) => {
                // Options already picked by a *different* row are excluded, not just
                // visually flagged - two rows both sending the same source value under
                // different PassCreator keys is never intentional and only invites the kind
                // of mismatched-row confusion this field mapping list has already caused.
                const usedByOtherRows = new Set(
                  form.walletFieldMapping.filter((r) => r.id !== row.id).map((r) => r.value),
                );
                const availableOptions = WALLET_PLACEHOLDER_OPTIONS.filter(
                  (o) => o.id === row.value || !usedByOtherRows.has(o.id),
                );
                const selectedOption = WALLET_PLACEHOLDER_OPTIONS.find((o) => o.id === row.value);
                const hintPreview = selectedOption
                  ? computeWalletPlaceholderPreview(selectedOption.id, form, walletLocationPreview)
                  : undefined;
                return (
                  <div className="wallet-field-mapping__row" key={row.id}>
                    <SearchableSelect
                      id={`event-wallet-field-mapping-${row.id}`}
                      label="Value"
                      placeholder="Select value…"
                      searchPlaceholder="Search values…"
                      emptyLabel="No values found"
                      showLabel={false}
                      value={row.value}
                      options={availableOptions}
                      disabled={isArchived || saving}
                      onChange={(value) =>
                        setForm({
                          ...form,
                          walletFieldMapping: form.walletFieldMapping.map((r) =>
                            r.id === row.id ? { ...r, value } : r,
                          ),
                        })
                      }
                    />
                    <div className="wallet-field-mapping__row-detail">
                      <Input
                        id={`event-wallet-field-mapping-key-${row.id}`}
                        name={`event-wallet-field-mapping-key-${row.id}`}
                        aria-label="PassCreator field key"
                        value={row.key}
                        disabled={isArchived || saving}
                        placeholder="PassCreator field key"
                        {...NO_AUTOFILL_PROPS}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            walletFieldMapping: form.walletFieldMapping.map((r) =>
                              r.id === row.id ? { ...r, key: e.target.value } : r,
                            ),
                          })
                        }
                      />
                      <Tooltip
                        content={hintPreview}
                        className="at-btn at-btn--secondary wallet-field-mapping__hint"
                      >
                        {selectedOption ? (
                          <i className="ti ti-info-circle at-btn__icon" aria-label={hintPreview} />
                        ) : (
                          <i className="ti ti-info-circle at-btn__icon" aria-hidden="true" />
                        )}
                      </Tooltip>
                      <Button
                        type="button"
                        id={`event-wallet-field-mapping-remove-${row.id}`}
                        name={`event-wallet-field-mapping-remove-${row.id}`}
                        variant="secondary"
                        disabled={isArchived || saving}
                        aria-label="Remove field"
                        onClick={() =>
                          setForm({
                            ...form,
                            walletFieldMapping: form.walletFieldMapping.filter((r) => r.id !== row.id),
                          })
                        }
                        icon={<i className="ti ti-trash" aria-hidden="true" />}
                      />
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      </Card>
      <WalletPushHistoryCard
        history={walletPushHistory}
        total={walletPushHistoryTotal}
        error={walletPushHistoryError}
        onRetry={onRetryWalletPushHistory}
        showLoading={showWalletPushHistoryLoading}
        page={walletPushHistoryPage}
        pageSize={walletPushHistoryPageSize}
        onPageChange={onWalletPushHistoryPageChange}
        onPageSizeChange={onWalletPushHistoryPageSizeChange}
      />
      {!isArchived && (
        <SettingsFooter
          validationErrors={computeWalletFieldMappingErrors(form.walletFieldMapping)}
          validationErrorsRef={validationErrorsRef}
          hasUnsavedChanges={dirty}
          saving={saving}
          onReset={onReset}
          onSave={onSave}
        />
      )}
    </>
  );
}
