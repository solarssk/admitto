import { useEffect, useId, useRef, useState } from "react";
import { LOCATION_LIMITS } from "@admitto/location";
import { Button, Input, ModalBackdrop } from "@admitto/ui";
import { useModalFocusTrap } from "../components/useModalFocusTrap.js";
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
  const [googleUrl, setGoogleUrl] = useState(initial.google_maps_url_override);
  const [appleUrl, setAppleUrl] = useState(initial.apple_maps_url_override);

  useEffect(() => {
    if (!open) return;
    setGoogleUrl(initial.google_maps_url_override);
    setAppleUrl(initial.apple_maps_url_override);
  }, [open, initial.google_maps_url_override, initial.apple_maps_url_override]);

  const handleClose = () => {
    onClose();
  };

  useModalFocusTrap(panelRef, open, handleClose);

  if (!open) return null;

  const handleSave = () => {
    onApply({
      google_maps_url_override: googleUrl,
      apple_maps_url_override: appleUrl,
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
      <div ref={panelRef} className="add-attendee-modal__panel" style={{ width: "min(94vw, 520px)" }}>
        <h2 className="add-attendee-modal__title" id={titleId}>
          Fix a wrong map link
        </h2>
        <p className="add-attendee-modal__hint">
          The map pin stays where it is. Paste a Google Maps or Apple Maps link that opens the
          correct place. Those links are used for Copy, browser tickets, and mail templates. Leave a
          field blank to build that link from the pin again.
        </p>
        <div className="add-attendee-modal__fields">
          <Input
            label="Google Maps link"
            value={googleUrl}
            onChange={(e) => setGoogleUrl(e.target.value)}
            maxLength={LOCATION_LIMITS.MAPS_URL_OVERRIDE_MAX_LENGTH}
            placeholder="https://www.google.com/maps/..."
            autoComplete="off"
          />
          <Input
            label="Apple Maps link"
            value={appleUrl}
            onChange={(e) => setAppleUrl(e.target.value)}
            maxLength={LOCATION_LIMITS.MAPS_URL_OVERRIDE_MAX_LENGTH}
            placeholder="https://maps.apple.com/..."
            autoComplete="off"
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
              Save links
            </Button>
          </div>
        </div>
      </div>
    </dialog>
  );
}
