import { useId, useState, type ReactNode } from "react";
import { Button, useToast } from "@admitto/ui";
import "./registration-access.css";

/**
 * One value to hand to IT: a read only box in the style of the return address on the card of the ways in (the field of the link for guests),
 * grey and in a fixed-width font, with the button that copies it in a frame on its left. Every value has the frame and the button; the
 * button is off while there is no value yet (a grey example shows instead), so that all the boxes of a record look alike.
 */
export function RecordField({ label, value, placeholder, copyLabel }: Readonly<{ label: string; value: string; placeholder: string; copyLabel: string }>) {
  const id = useId();
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
        <input id={id} className="at-input access-readonly" value={value} placeholder={placeholder} readOnly />
      </div>
    </div>
  );
}

/**
 * The setup for the organisation's IT department, in a panel that opens and closes under its heading, with a button that copies all of it as
 * text for a person or an agent. It is shut until it is opened: it is a help, not a part of the form. The steps (an ordered list) are the children.
 */
export function ItPanel({ text, children }: Readonly<{ /** What the button copies: whole in itself. */ text: string; children: ReactNode }>) {
  const bodyId = useId();
  const { addToast } = useToast();
  const [open, setOpen] = useState(false);

  async function copyAll() {
    try {
      await navigator.clipboard.writeText(text);
      addToast("Instructions copied.", "success");
    } catch {
      addToast("Could not copy. Try again.", "error");
    }
  }

  return (
    <section className="access-it" aria-label="Setup for your IT team">
      <div className="access-it__head">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="access-it__toggle"
          icon={<i className={`ti ti-chevron-${open ? "down" : "right"}`} aria-hidden="true" />}
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setOpen((current) => !current)}
        >
          Setup for your IT team
        </Button>
        <Button type="button" variant="secondary" size="sm" icon={<i className="ti ti-copy" aria-hidden="true" />} onClick={() => void copyAll()}>
          Copy instructions for an AI agent
        </Button>
      </div>
      <div id={bodyId} className="access-it__body" hidden={!open}>
        <ol className="access-steps">{children}</ol>
      </div>
    </section>
  );
}
