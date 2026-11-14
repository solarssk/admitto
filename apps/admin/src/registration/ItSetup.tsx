import { useId, useState, type ReactNode } from "react";
import { Button, Input, useToast } from "@admitto/ui";
import "./registration-access.css";

/**
 * One value to hand to IT: a read only box in the style of the return address on the card of the ways in (the field of the link for guests),
 * grey and in a fixed-width font, with the button that copies it on its left. Without a value it shows a grey example and no button.
 */
export function RecordField({ label, value, placeholder, copyLabel }: Readonly<{ label: string; value: string; placeholder: string; copyLabel?: string }>) {
  const { addToast } = useToast();
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      addToast("Copied.", "success");
    } catch {
      addToast("Could not copy.", "error");
    }
  }
  const copyable = copyLabel !== undefined && value !== "";
  return (
    <Input
      label={label}
      value={value}
      placeholder={placeholder}
      readOnly
      className="access-readonly"
      {...(copyable ? { icon: <i className="ti ti-copy" />, iconLabel: copyLabel, onIconClick: () => void copy() } : {})}
    />
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
