import { useEffect, useId, useRef, useState } from "react";
import {
  LOCATION_LIMITS,
  LocationValidationError,
  normalizeMapsUrlOverride,
} from "@admitto/location";
import { Button, Input, ModalBackdrop } from "@admitto/ui";
import { useModalFocusTrap } from "../components/useModalFocusTrap.js";
import { useOverscrollBounceGuard } from "../hooks/useOverscrollBounceGuard.js";
import "../attendees/add-attendee-modal.css";

export interface FixMapsLinkModalValues {
  google_maps_url_override: string;
  apple_maps_url_override: string;
}

export interface FixMapsLinkModalProps {
  readonly open: boolean;
  readonly initial: FixMapsLinkModalValues;
  readonly onClose: () => void;
  /** Applies overrides to the Location draft (panel Save persists them). */
  readonly onApply: (values: FixMapsLinkModalValues) => void;
}

function validateOverrideField(
  value: string,
  kind: "google" | "apple",
  fieldLabel: string,
): { ok: true; value: string } | { ok: false; error: string } {
  try {
    const normalized = normalizeMapsUrlOverride(value, kind, fieldLabel);
    return { ok: true, value: normalized ?? "" };
  } catch (err) {
    const message =
      err instanceof LocationValidationError ? err.message : `${fieldLabel} is invalid`;
    return { ok: false, error: message };
  }
}

/**
 * Paste corrected Google / Apple Maps deep links when the pin-built URL opens the wrong place.
 * Does not move the OSM pin. Save applies to the draft; the Location tab footer still persists.
 */
export function FixMapsLinkModal({
  open,
  initial,
  onClose,
  onApply,
}: Readonly<FixMapsLinkModalProps>) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  useOverscrollBounceGuard(scrollRef, open);
  const [googleUrl, setGoogleUrl] = useState(initial.google_maps_url_override);
  const [appleUrl, setAppleUrl] = useState(initial.apple_maps_url_override);
  const [googleError, setGoogleError] = useState<string | null>(null);
  const [appleError, setAppleError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setGoogleUrl(initial.google_maps_url_override);
    setAppleUrl(initial.apple_maps_url_override);
    setGoogleError(null);
    setAppleError(null);
  }, [open, initial.google_maps_url_override, initial.apple_maps_url_override]);

  const handleClose = () => {
    onClose();
  };

  useModalFocusTrap(panelRef, open, handleClose);

  if (!open) return null;

  const handleSave = () => {
    const google = validateOverrideField(googleUrl, "google", "Google Maps link");
    const apple = validateOverrideField(appleUrl, "apple", "Apple Maps link");
    setGoogleError(google.ok ? null : google.error);
    setAppleError(apple.ok ? null : apple.error);
    if (!google.ok || !apple.ok) return;

    onApply({
      google_maps_url_override: google.value,
      apple_maps_url_override: apple.value,
    });
    onClose();
  };

  const handleRemove = () => {
    onApply({
      google_maps_url_override: "",
      apple_maps_url_override: "",
    });
    onClose();
  };

  const hasAnyOverride =
    initial.google_maps_url_override.trim().length > 0 ||
    initial.apple_maps_url_override.trim().length > 0;

  return (
    <dialog open className="add-attendee-modal" aria-modal="true" aria-labelledby={titleId}>
      <ModalBackdrop onClose={handleClose} />
      <div ref={panelRef} className="add-attendee-modal__panel add-attendee-modal__panel--w520">
      <div ref={scrollRef} className="add-attendee-modal__scroll at-scroll">
        <h2 className="add-attendee-modal__title" id={titleId}>
          Fix a wrong map link
        </h2>
        <p className="add-attendee-modal__hint">
          The map pin stays where it is. Paste a Google Maps or Apple Maps link that opens the
          correct place. Those links are used for Copy, browser tickets, and mail templates. Leave a
          field blank to build that link from the pin again. Apply updates the draft — use Save in
          Location settings to persist the changes.
        </p>
        <div className="add-attendee-modal__fields">
          <Input
            label="Google Maps link"
            value={googleUrl}
            onChange={(e) => {
              setGoogleUrl(e.target.value);
              setGoogleError(null);
            }}
            maxLength={LOCATION_LIMITS.MAPS_URL_OVERRIDE_MAX_LENGTH}
            placeholder="https://www.google.com/maps/..."
            autoComplete="off"
            error={googleError ?? undefined}
          />
          <Input
            label="Apple Maps link"
            value={appleUrl}
            onChange={(e) => {
              setAppleUrl(e.target.value);
              setAppleError(null);
            }}
            maxLength={LOCATION_LIMITS.MAPS_URL_OVERRIDE_MAX_LENGTH}
            placeholder="https://maps.apple.com/..."
            autoComplete="off"
            error={appleError ?? undefined}
          />
        </div>
        <div className="add-attendee-modal__actions" style={{ justifyContent: "space-between" }}>
          <div>
            {hasAnyOverride && (
              <Button type="button" variant="ghost" onClick={handleRemove}>
                Remove overrides
              </Button>
            )}
          </div>
          <div style={{ display: "flex", gap: "var(--space-2)" }}>
            <Button type="button" variant="secondary" onClick={handleClose}>
              Cancel
            </Button>
            <Button type="button" variant="primary" onClick={handleSave}>
              Apply links
            </Button>
          </div>
        </div>
      </div>
      </div>
    </dialog>
  );
}
