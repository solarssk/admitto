import { useId, useState, type ReactNode } from "react";
import { Button, useToast } from "@admitto/ui";
import "./registration-access.css";

/** One value of a record to hand to IT, in a box as high as a field, or a grey example while there is none, with a button that copies it. */
export function RecordCell({
  label,
  value,
  placeholder,
  copyLabel,
  arrow,
}: Readonly<{ label: string; value: string; placeholder: string; copyLabel?: string; arrow?: boolean }>) {
  const { addToast } = useToast();
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      addToast("Copied.", "success");
    } catch {
      addToast("Could not copy.", "error");
    }
  }
  return (
    <div className="access-dns__cell" data-label={label}>
      {arrow === true && (
        <span className="access-dns__arrow" aria-hidden="true">
          <i className="ti ti-arrow-right" />
        </span>
      )}
      <span className={value === "" ? "access-dns__value access-dns__value--placeholder" : "access-dns__value"} title={value === "" ? undefined : value}>
        {value === "" ? placeholder : value}
      </span>
      {copyLabel !== undefined && value !== "" && (
        <button type="button" className="access-dns__copy" aria-label={copyLabel} onClick={() => void copy()}>
          <i className="ti ti-copy" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

/**
 * The setup for the organisation's IT department, in a panel that opens and closes under its heading, with a button that copies all of it as
 * text for a person or an agent. The steps (an ordered list) are the children.
 */
export function ItPanel({
  defaultOpen,
  text,
  children,
}: Readonly<{ defaultOpen: boolean; /** What the button copies: whole in itself. */ text: string; children: ReactNode }>) {
  const bodyId = useId();
  const { addToast } = useToast();
  const [open, setOpen] = useState(defaultOpen);

  async function copyAll() {
    try {
      await navigator.clipboard.writeText(text);
      addToast("Instructions copied.", "success");
    } catch {
      addToast("Could not copy.", "error");
    }
  }

  return (
    <section className="access-it" aria-label="Setup for your IT team">
      <div className="access-it__head">
        <Button
          type="button"
          variant="ghost"
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
