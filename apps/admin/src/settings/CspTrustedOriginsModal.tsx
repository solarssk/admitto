import { useEffect, useId, useRef, useState } from "react";
import { Button, Input, ModalBackdrop } from "@admitto/ui";
import { isValidCspTrustedOrigin, MAX_CSP_TRUSTED_ORIGINS } from "@admitto/auth/csp-trusted-origins";
import { useModalFocusTrap } from "../components/useModalFocusTrap.js";
import { useOverscrollBounceGuard } from "../hooks/useOverscrollBounceGuard.js";
import "../attendees/add-attendee-modal.css";
import "./csp-trusted-origins-modal.css";

export interface CspTrustedOriginsModalProps {
  readonly open: boolean;
  readonly initialOrigins: readonly string[];
  readonly onClose: () => void;
  readonly onSave: (origins: string[]) => void;
}

/** Add/remove editor for Settings → Security's trusted CSP origins, one origin per row instead
 * of a single comma-separated text field - a wall of https:// URLs in one line is hard to read
 * or edit once there's more than one. Each entry is validated on add, so the list this hands back
 * to the panel's draft is always well-formed. */
export function CspTrustedOriginsModal({
  open,
  initialOrigins,
  onClose,
  onSave,
}: CspTrustedOriginsModalProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  useOverscrollBounceGuard(scrollRef, open);

  const [origins, setOrigins] = useState<string[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setOrigins([...initialOrigins]);
    setInputValue("");
    setError(null);
    // Only reseed when the modal opens, not on every render of a fresh `initialOrigins` array.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useModalFocusTrap(panelRef, open, onClose);

  if (!open) return null;

  function addOrigin() {
    const value = inputValue.trim();
    if (!value) return;
    if (!isValidCspTrustedOrigin(value)) {
      setError(
        value.includes("*")
          ? `"${value}" contains a wildcard (*). Enter one exact https:// origin instead.`
          : `"${value}" is not a valid https:// origin.`,
      );
      return;
    }
    if (origins.includes(value)) {
      setError(`"${value}" is already in the list.`);
      return;
    }
    if (origins.length >= MAX_CSP_TRUSTED_ORIGINS) {
      setError(`At most ${MAX_CSP_TRUSTED_ORIGINS} trusted origins are allowed.`);
      return;
    }
    setOrigins((prev) => [...prev, value]);
    setInputValue("");
    setError(null);
  }

  function removeOrigin(value: string) {
    setOrigins((prev) => prev.filter((o) => o !== value));
  }

  function handleSave() {
    onSave(origins);
    onClose();
  }

  return (
    <dialog className="add-attendee-modal" open aria-modal="true" aria-labelledby={titleId}>
      <ModalBackdrop onClose={onClose} />
      <div ref={panelRef} className="add-attendee-modal__panel" style={{ width: "min(94vw, 560px)" }}>
        <div ref={scrollRef} className="add-attendee-modal__scroll">
          <h2 className="add-attendee-modal__title" id={titleId}>
            <i className="ti ti-shield-lock" aria-hidden="true" />
            Trusted third-party script origins
          </h2>
          <p className="add-attendee-modal__subtitle">
            Extra https:// origins allowed to run script, send data, and (on sign-in pages) render
            an embedded widget, for example an analytics/monitoring beacon like Cloudflare Web
            Analytics, or a login challenge widget like Cloudflare Turnstile. Does not apply to the
            public ticket page.
          </p>
          <div className="fontfam-modal-body">
            <div className="csp-origin-row">
              <Input
                label="Add an origin"
                placeholder="https://static.cloudflareinsights.com"
                value={inputValue}
                error={error ?? undefined}
                onChange={(e) => {
                  setInputValue(e.target.value);
                  if (error) setError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  e.preventDefault();
                  addOrigin();
                }}
              />
              <Button type="button" variant="secondary" onClick={addOrigin}>
                <i className="ti ti-plus" aria-hidden="true" /> Add
              </Button>
            </div>

            {origins.length === 0 ? (
              <p className="at-hint">No trusted origins yet.</p>
            ) : (
              <div className="csp-origin-chips">
                {origins.map((origin) => (
                  <span className="csp-origin-chip" key={origin}>
                    {origin}
                    <button
                      type="button"
                      className="csp-origin-chip-remove"
                      onClick={() => removeOrigin(origin)}
                      aria-label={`Remove ${origin}`}
                    >
                      <i className="ti ti-x" aria-hidden="true" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="add-attendee-modal__actions" style={{ justifyContent: "flex-end" }}>
            <div className="add-attendee-modal__actions-buttons">
              <Button variant="secondary" onClick={onClose}>
                Cancel
              </Button>
              <Button variant="primary" onClick={handleSave}>
                Done
              </Button>
            </div>
          </div>
        </div>
      </div>
    </dialog>
  );
}
