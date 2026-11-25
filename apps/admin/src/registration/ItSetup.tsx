import { useId, useState, type ReactNode } from "react";
import { Button, useToast } from "@admitto/ui";
import "./registration-access.css";

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
