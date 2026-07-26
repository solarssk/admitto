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
  disabled,
  className,
  onChange,
}: Readonly<{
  options: ReadonlyArray<SegmentedOption<T>>;
  value: T;
  ariaLabel: string;
  disabled?: boolean;
  className?: string;
  onChange: (value: T) => void;
}>) {
  return (
    <div
      className={className ? `seg-control ${className}` : "seg-control"}
      role="radiogroup"
      aria-label={ariaLabel}
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
