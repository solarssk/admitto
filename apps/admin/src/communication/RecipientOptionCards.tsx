import { Notice } from "@admitto/ui";

export interface RecipientOption<T extends string> {
  value: T;
  label: string;
  description: string;
  icon: string;
}

interface RecipientOptionCardsProps<T extends string> {
  options: ReadonlyArray<RecipientOption<T>>;
  value: T;
  onChange: (value: T) => void;
  /** Namespaces each option's own aria-describedby id (e.g. "wallets-recipient" vs
   * "communication-recipient") so two instances mounted at once (Send + Wallets tabs) never
   * collide on the same id. */
  idPrefix: string;
  disabled: boolean;
}

/** Recipient-filter radiogroup shared by CommunicationSendPanel (mail) and WalletsSendPanel
 * (wallet push) - identical card/radio markup, only the option list and value type differ. */
export function RecipientOptionCards<T extends string>({
  options,
  value,
  onChange,
  idPrefix,
  disabled,
}: Readonly<RecipientOptionCardsProps<T>>) {
  return (
    <div className="communication-recipient-cards" role="radiogroup" aria-label="Recipients">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          role="radio"
          aria-checked={value === opt.value}
          aria-label={opt.label}
          aria-describedby={`${idPrefix}-${opt.value}-desc`}
          disabled={disabled}
          className={["communication-recipient-card", value === opt.value && "communication-recipient-card--active"]
            .filter(Boolean)
            .join(" ")}
          onClick={() => onChange(opt.value)}
        >
          <i className={`ti ${opt.icon}`} aria-hidden="true" />
          <span className="communication-recipient-card__text">
            <span className="communication-recipient-card__label" aria-hidden="true">
              {opt.label}
            </span>
            <span id={`${idPrefix}-${opt.value}-desc`} className="communication-recipient-card__description">
              {opt.description}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}

/** Dry-run result notice shared by the same two panels - "N recipients matched" / "no recipients
 * match this filter" / nothing yet. */
export function RecipientCountNotice({ count }: Readonly<{ count: number | null }>) {
  if (count == null) return null;
  if (count === 0) {
    return (
      <Notice variant="warning" as="output">
        No recipients match this filter.
      </Notice>
    );
  }
  return (
    <Notice variant="success" as="output">
      <strong>{count}</strong> recipient{count === 1 ? "" : "s"} matched
    </Notice>
  );
}
