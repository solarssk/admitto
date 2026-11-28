import { useId } from "react";
import { useToast } from "@admitto/ui";
import "./copy-field.css";

export interface CopyFieldProps {
  label: string;
  /** What the button copies. */
  value: string;
  /** A grey example that shows while there is no value. */
  placeholder?: string;
  /** The accessible name of the copy button. */
  copyLabel: string;
  /** A line under the box. */
  hint?: string;
}

/**
 * A value that a person copies and does not edit: a read only box, grey and in a fixed-width font, with the button that copies it in a frame on
 * its left. It is the one such box of the admin (the return addresses, the DNS record, the redirect address of an identity provider), so that none
 * is written again. The button is off while there is no value yet (a grey example shows instead), so that all the boxes of a group look alike.
 */
export function CopyField({ label, value, placeholder = "", copyLabel, hint }: Readonly<CopyFieldProps>) {
  const id = useId();
  const hintId = `${id}-hint`;
  const { addToast } = useToast();
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      addToast("Copied.", "success");
    } catch {
      addToast("Could not copy. Select the text and copy it by hand.", "error");
    }
  }
  return (
    <div className="at-field">
      <label className="at-label" htmlFor={id}>
        {label}
      </label>
      <div className="at-inputgroup">
        <button type="button" className="at-inputgroup__icon at-inputgroup__icon--action" aria-label={copyLabel} disabled={value === ""} onClick={() => void copy()}>
          <i className="ti ti-copy" aria-hidden="true" />
        </button>
        <input id={id} className="at-input copy-field__input" value={value} placeholder={placeholder} readOnly aria-describedby={hint ? hintId : undefined} />
      </div>
      {hint ? (
        <span id={hintId} className="at-hint">
          {hint}
        </span>
      ) : null}
    </div>
  );
}
