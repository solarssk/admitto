/** Small 2+ option exclusive-choice toggle — e.g. Organization mail / Dedicated for this event. */
export interface SegmentedOption<T extends string> {
  readonly value: T;
  readonly label: string;
  /** Present but not yet selectable — e.g. a feature announced in the UI ahead of its backing
   * data existing. Disables only this option; the rest of the control stays interactive. */
  readonly disabled?: boolean;
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
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            className={`seg-btn${active ? " seg-btn--active" : ""}`}
            disabled={disabled || opt.disabled}
            onClick={() => onChange(opt.value)}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
