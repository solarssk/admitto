/** Small 2+ option exclusive-choice toggle — e.g. Organization mail / Dedicated for this event. */
export interface SegmentedOption<T extends string> {
  readonly value: T;
  readonly label: string;
}

export function Segmented<T extends string>({
  options,
  value,
  ariaLabel,
  disabled,
  onChange,
}: Readonly<{
  options: ReadonlyArray<SegmentedOption<T>>;
  value: T;
  ariaLabel: string;
  disabled?: boolean;
  onChange: (value: T) => void;
}>) {
  return (
    <div className="seg-control" role="radiogroup" aria-label={ariaLabel}>
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            className={`seg-btn${active ? " seg-btn--active" : ""}`}
            disabled={disabled}
            onClick={() => onChange(opt.value)}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
