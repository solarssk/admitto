import { Badge, Card, HintLabel, Input } from "@admitto/ui";
import type { EventSettingsDto, EventType } from "../api/types.js";
import { DatePicker } from "../components/DatePicker.js";
import { SearchableSelect } from "../components/SearchableSelect.js";
import { TimeInput } from "../components/TimeInput.js";
import { TimezoneSelect } from "../components/TimezoneSelect.js";
import type { EventSettingsFormPanelProps } from "../pages/EventSettingsPage.js";
import { formatEventDateTime, formatUtcDateTime } from "../utils/event-dates.js";
import { buildEventTypeOptions } from "./eventTypeOptions.js";
import { SettingsFooter, NO_AUTOFILL_PROPS } from "./mailTransportFormParts.js";

const BASIC_INFORMATION_HINT = "Title, date, capacity, and timezone.";
const BASIC_INFORMATION_INTRO = "Set the event details used across admin and tickets.";
const STATUS_HINT = "Current event status and ownership.";

/** Basic information's Event type picker - same icon+label SearchableSelect pattern as the
 * Wallet tab's field mapping "Value" dropdown. Leading blank option makes the field clearable
 * back to unset, same as the Ticket type picker elsewhere (AddAttendeeModal.tsx,
 * AttendeeDetailPage.tsx) - SearchableSelect has no other way to unpick a value once one is
 * selected. */
const EVENT_TYPE_SELECT_OPTIONS = [
  { id: "", label: "Not set" },
  ...buildEventTypeOptions().map((option) => ({
    id: option.value,
    label: option.label,
    icon: option.icon,
  })),
];

/** Created/Archived stamp in the acting admin's timezone when known; UTC fallback for legacy rows. */
function formatActorStamp(iso: string, timezone: string | null | undefined): string {
  return timezone ? formatEventDateTime(iso, timezone) : formatUtcDateTime(iso);
}

/** General tab: event status summary and basic information (title, date, capacity, event type,
 * hours, timezone). */
export function EventGeneralInfoPanel({
  event,
  form,
  setForm,
  isArchived,
  saving,
  logoUploading,
  dirty,
  validationErrorsRef,
  onReset,
  onSave,
}: Readonly<
  EventSettingsFormPanelProps & {
    event: EventSettingsDto;
    logoUploading: boolean;
  }
>) {
  return (
    <>
      <Card title={<HintLabel hint={STATUS_HINT}>Status</HintLabel>} className="event-settings-card">
        <div className="settings-status-grid">
          <div className="settings-field-group">
            <p>
              Current status:{" "}
              <Badge variant={isArchived ? "neutral" : "info"} dot={false}>
                {isArchived ? "Archived" : "Active"}
              </Badge>
            </p>
            <p className="field-hint">
              {isArchived && event.archived_at
                ? `Archived on ${formatActorStamp(event.archived_at, event.archived_by_timezone)}.`
                : "Active events accept check-ins and allow attendee edits."}
            </p>
          </div>
          <div className="settings-field-group">
            <p>
              Organization: <strong>{event.organization_name}</strong>
            </p>
            <p className="field-hint">Events belong to an organization and use its branding by default.</p>
          </div>
          <div className="settings-field-group">
            <p>
              Created:{" "}
              <strong>
                {event.created_at
                  ? formatActorStamp(event.created_at, event.created_by_timezone)
                  : "-"}
              </strong>
            </p>
            <p className="field-hint">When this event was first set up.</p>
          </div>
        </div>
      </Card>

      <Card
        title={<HintLabel hint={BASIC_INFORMATION_HINT}>Basic information</HintLabel>}
        className="event-settings-card"
      >
        <div className="settings-field-stack">
          <p className="settings-card-intro">{BASIC_INFORMATION_INTRO}</p>
          <div className="settings-field-group">
            <Input
              label="Event title"
              required
              value={form.title}
              disabled={isArchived || saving}
              hint="Shown everywhere - to attendees, on tickets, and in emails."
              {...NO_AUTOFILL_PROPS}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </div>

          <div className="settings-field-row settings-field-row--3">
            <div className="settings-field-group">
              <DatePicker
                label="Date"
                required
                value={form.date}
                disabled={isArchived || saving}
                onChange={(next) => setForm({ ...form, date: next })}
              />
              <span className="at-hint">When the event takes place.</span>
            </div>

            <div className="settings-field-group">
              <Input
                label="Capacity"
                type="number"
                min={1}
                value={form.capacity}
                disabled={isArchived || saving}
                placeholder="500"
                hint="Leave blank for unlimited."
                onChange={(e) => setForm({ ...form, capacity: e.target.value })}
              />
            </div>

            <div className="settings-field-group">
              <SearchableSelect
                id="event-basic-event-type"
                label="Event type"
                placeholder="Not set"
                searchPlaceholder="Search event types…"
                emptyLabel="No event types found"
                value={form.eventType}
                options={EVENT_TYPE_SELECT_OPTIONS}
                disabled={isArchived || saving}
                hint="For Wallet's Siri/Maps/Calendar fields."
                onChange={(value) => setForm({ ...form, eventType: value as EventType | "" })}
              />
            </div>
          </div>

          <div className="settings-event-schedule">
            <div className="settings-event-schedule__hours">
              <div className="settings-field-row">
                <div className="settings-field-group">
                  <TimeInput
                    label="Event hours (start)"
                    value={form.eventHoursStart}
                    disabled={isArchived || saving}
                    onChange={(value) => setForm({ ...form, eventHoursStart: value })}
                  />
                </div>
                <div className="settings-field-group">
                  <TimeInput
                    label="Event hours (end)"
                    value={form.eventHoursEnd}
                    disabled={isArchived || saving}
                    onChange={(value) => setForm({ ...form, eventHoursEnd: value })}
                  />
                </div>
              </div>
              <span className="at-hint">Optional. Shown on tickets and wallet passes as a time range.</span>
            </div>

            <div className="settings-field-group event-settings-timezone">
              <label className="at-label" htmlFor="event-timezone">
                Event timezone
              </label>
              <TimezoneSelect
                id="event-timezone"
                compact
                value={form.timezone}
                onChange={(tz) => setForm({ ...form, timezone: tz })}
                disabled={isArchived || saving}
              />
              <span className="at-hint">All check-in times and reports use this timezone.</span>
            </div>
          </div>

          <div className="settings-field-group slug-field">
            <Input
              label="Event link ID"
              value={event.slug}
              readOnly
              disabled
              className="mono"
              icon={<i className="ti ti-link" aria-hidden="true" />}
              hint="This can't be changed after the event is created - it's already part of every QR code sent to attendees."
            />
          </div>
        </div>
      </Card>

      {!isArchived && (
        <SettingsFooter
          validationErrors={[]}
          validationErrorsRef={validationErrorsRef}
          hasUnsavedChanges={dirty}
          saving={saving || logoUploading}
          busyLabel={logoUploading && !saving ? "Uploading…" : "Saving…"}
          onReset={onReset}
          onSave={onSave}
        />
      )}
    </>
  );
}
