import { Card, HintLabel } from "@admitto/ui";
import { uploadEventBrandingFile } from "../api/client.js";
import { EventImageAssetLibrary } from "../components/EventImageAssetLibrary.js";
import { LogoUploadZone } from "../components/LogoUploadZone.js";
import type { EventSettingsFormPanelProps, SettingsForm } from "../pages/EventSettingsPage.js";
import { SettingsFooter } from "./mailTransportFormParts.js";

const EVENT_LOGO_HINT = "Overrides the organisation logo for this event.";

/** Images tab: event logo upload/crop and the event's image asset library. */
export function EventImagesPanel({
  eventId,
  form,
  setForm,
  original,
  isArchived,
  saving,
  logoUploading,
  onUploadingChange,
  dirty,
  validationErrorsRef,
  onReset,
  onSave,
}: Readonly<
  EventSettingsFormPanelProps & {
    eventId: string;
    original: SettingsForm;
    logoUploading: boolean;
    onUploadingChange: (uploading: boolean) => void;
  }
>) {
  return (
    <div className="settings-sections">
      <Card
        title={<HintLabel hint={EVENT_LOGO_HINT}>Event logo</HintLabel>}
        className="event-settings-card"
      >
        <LogoUploadZone
          label="Event logo"
          hideLabel
          hint="PNG, JPG, WebP · max 2 MB · leave blank to use the organization's logo"
          value={form.logoUrl}
          originalUrl={form.logoOriginalUrl || null}
          cropMeta={form.logoCrop}
          committedValue={original.logoUrl}
          committedOriginalUrl={original.logoOriginalUrl}
          disabled={isArchived || saving}
          onChange={(url) => setForm((prev) => prev && { ...prev, logoUrl: url })}
          onSourceChange={(source) =>
            setForm(
              (prev) =>
                prev && {
                  ...prev,
                  logoOriginalUrl: source.originalUrl ?? "",
                  logoCrop: source.crop,
                },
            )
          }
          uploadFn={(fd) => uploadEventBrandingFile(eventId, fd)}
          onUploadingChange={onUploadingChange}
        />
        {isArchived && (
          <p className="field-hint event-settings-archived-note">
            This event is archived - images cannot be changed.
          </p>
        )}
      </Card>

      <EventImageAssetLibrary eventId={eventId} disabled={isArchived} />

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
    </div>
  );
}
