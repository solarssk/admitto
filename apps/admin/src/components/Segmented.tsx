import { useId } from "react";
import { Tooltip } from "@admitto/ui";

/** Small 2+ option exclusive-choice toggle — e.g. Organization mail / Dedicated for this event. */
export interface SegmentedOption<T extends string> {
  readonly value: T;
  readonly label: string;
  /** Present but not yet selectable — e.g. a feature announced in the UI ahead of its backing
   * data existing. Disables only this option; the rest of the control stays interactive. */
  readonly disabled?: boolean;
  /** Why the option is off, or what it is: a hover and focus tooltip, and a hidden description for a screen reader (a disabled button
   * takes no focus, so the tooltip's own tab stop carries it). */
  readonly tooltip?: string;
}

/** One option. With a tooltip the button is wrapped in it and described by the same text, kept out of sight. */
function SegmentedButton<T extends string>({
  option,
  active,
  disabled,
  onChange,
}: Readonly<{ option: SegmentedOption<T>; active: boolean; disabled?: boolean; onChange: (value: T) => void }>) {
  const noteId = useId();
  const button = (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      aria-describedby={option.tooltip ? noteId : undefined}
      className={`seg-btn${active ? " seg-btn--active" : ""}`}
      disabled={disabled || option.disabled}
      onClick={() => onChange(option.value)}
    >
      {option.label}
    </button>
  );
  if (!option.tooltip) return button;
  return (
    <Tooltip content={option.tooltip}>
      {button}
      <span id={noteId} className="sr-only">
        {option.tooltip}
      </span>
    </Tooltip>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  ariaLabel,
  describedBy,
  disabled,
  className,
  onChange,
}: Readonly<{
  options: ReadonlyArray<SegmentedOption<T>>;
  /** The option that is chosen, or `null` while none is (a choice that has not been made yet). */
  value: T | null;
  ariaLabel: string;
  /** The id of the text that says more about the choice, such as why an option is off. */
  describedBy?: string;
  disabled?: boolean;
  className?: string;
  onChange: (value: T) => void;
}>) {
  return (
    <div
      className={className ? `seg-control ${className}` : "seg-control"}
      role="radiogroup"
      aria-label={ariaLabel}
      aria-describedby={describedBy}
    >
      {options.map((opt) => (
        <SegmentedButton key={opt.value} option={opt} active={opt.value === value} disabled={disabled} onChange={onChange} />
      ))}
    </div>
  );
}
