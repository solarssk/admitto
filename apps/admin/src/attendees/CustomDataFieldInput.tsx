import { useState } from "react";
import { CONTACT_PHONE_MAX_LENGTH, sanitizeContactPhoneInput } from "@admitto/shared";
import { Input, type InputProps } from "@admitto/ui";
import { DatePicker } from "../components/DatePicker.js";
import { PhoneCountrySelect } from "../components/PhoneCountrySelect.js";
import { SearchableSelect } from "../components/SearchableSelect.js";
import { TimeInput } from "../components/TimeInput.js";
import { attendeeFieldAttrs } from "../utils/no-autofill.js";
import { composePhoneE164, splitPhoneForPicker } from "../utils/phoneCountries.js";
import { answerHint, codePointLength, joinDateTime, longTextLimit, splitDateTime } from "./answerFormat.js";
import { customDataFieldLabel, type CustomDataFieldDef } from "./customData.js";
import "./custom-data-field-input.css";

export interface CustomDataFieldInputProps {
  field: CustomDataFieldDef;
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  /** The event's time zone: a date and time answer is the time on the clock there, and the input says so. */
  eventTimeZone?: string;
}

/** A long answer: a box that grows by hand, with a count of the characters as the server counts them (an emoji is one) against
 * the limit, so that a text that is too long is seen before it is sent. */
function LongTextInput({ field, value, disabled, onChange }: Readonly<CustomDataFieldInputProps>) {
  const fieldId = `custom-field-${field.source_field}`;
  const limit = longTextLimit(field);
  const count = codePointLength(value.trim());
  const over = count > limit;
  const hint = answerHint(field);
  const describedBy = [hint ? `${fieldId}-hint` : null, `${fieldId}-count`].filter(Boolean).join(" ");
  return (
    <div className="at-field custom-data-field--wide">
      <label className="at-label" htmlFor={fieldId}>
        {customDataFieldLabel(field)}
      </label>
      <textarea
        id={fieldId}
        className={`at-textarea${over ? " at-textarea--invalid" : ""}`}
        rows={4}
        value={value}
        disabled={disabled}
        required={field.required}
        aria-invalid={over || undefined}
        aria-describedby={describedBy}
        onChange={(e) => onChange(e.target.value)}
      />
      <div className="custom-data-field__meta">
        {hint ? (
          <span id={`${fieldId}-hint`} className="at-hint">
            {hint}
          </span>
        ) : null}
        <span id={`${fieldId}-count`} className={`at-hint custom-data-field__count${over ? " at-hint--error" : ""}`}>
          {over ? `${count} / ${limit}, ${count - limit} too many` : `${count} / ${limit}`}
        </span>
      </div>
    </div>
  );
}

/** A date and a time of day side by side, held as one answer (`YYYY-MM-DDTHH:mm`, the time at the event). While only one half is
 * filled in, the answer is the half with an empty other (`2026-11-04T`), which the form refuses to send. */
function DateTimeInput({ field, value, disabled, onChange, eventTimeZone }: Readonly<CustomDataFieldInputProps>) {
  const labelId = `custom-field-${field.source_field}-label`;
  const { date, time } = splitDateTime(value);
  const hint = answerHint(field, eventTimeZone);
  return (
    <fieldset className="at-field custom-data-field__group" aria-labelledby={labelId}>
      <span className="at-label" id={labelId}>
        {customDataFieldLabel(field)}
      </span>
      <div className="custom-data-field__datetime">
        <DatePicker
          ariaLabel={`${field.label}, date`}
          value={date}
          disabled={disabled}
          onChange={(next) => onChange(joinDateTime(next, time))}
        />
        <TimeInput
          ariaLabel={`${field.label}, time`}
          value={time}
          disabled={disabled}
          onChange={(next) => onChange(joinDateTime(date, next))}
          // A time that was typed and cannot be read must not leave the one before it in the answer: it counts as no time.
          onValidityChange={(valid) => {
            if (!valid) onChange(joinDateTime(date, ""));
          }}
        />
      </div>
      {hint ? <span className="at-hint">{hint}</span> : null}
    </fieldset>
  );
}

/** A phone number, in the picker the staff phone fields use: a country code with its flag, and the number beside it. The answer is
 * still one value, the code and the digits (`+48600100200`). With no code picked the number is typed whole, and may start with a +. */
function PhoneInput({ field, value, disabled, onChange }: Readonly<CustomDataFieldInputProps>) {
  const fieldId = `custom-field-${field.source_field}`;
  const hint = answerHint(field);
  // What was typed stays as typed: the answer holds only the digits, and is empty while a code is picked and no number is.
  const [typed, setTyped] = useState(() => ({ ...splitPhoneForPicker(value), answer: value }));
  // An answer the form changed (cleared, or another attendee's) takes the place of what was typed.
  if (value !== typed.answer) setTyped({ ...splitPhoneForPicker(value), answer: value });
  const change = (dialCode: string, nationalNumber: string): void => {
    const answer = composePhoneE164(dialCode, nationalNumber);
    setTyped({ dialCode, nationalNumber, answer });
    onChange(answer);
  };
  return (
    <div className="at-field">
      <label className="at-label" htmlFor={fieldId}>
        {customDataFieldLabel(field)}
      </label>
      <div className="custom-data-field__phone-row">
        <PhoneCountrySelect
          id={`${fieldId}-country`}
          label={`${field.label} country code`}
          value={typed.dialCode}
          disabled={disabled}
          // The picker supplies the country code, so a typed "+" has no place in the number.
          onChange={(code) => change(code, sanitizeContactPhoneInput(typed.nationalNumber, !code))}
        />
        <Input
          id={fieldId}
          type="tel"
          inputMode="tel"
          maxLength={CONTACT_PHONE_MAX_LENGTH}
          value={typed.nationalNumber}
          disabled={disabled}
          required={field.required}
          aria-describedby={hint ? `${fieldId}-hint` : undefined}
          onChange={(e) => {
            // A number typed or pasted with its country code sets the picker, instead of becoming a second code after the one picked.
            const text = sanitizeContactPhoneInput(e.target.value, true);
            const next = text.startsWith("+") ? splitPhoneForPicker(text) : { dialCode: typed.dialCode, nationalNumber: text };
            change(next.dialCode, next.nationalNumber);
          }}
          {...attendeeFieldAttrs(fieldId)}
        />
      </div>
      {hint ? (
        <span id={`${fieldId}-hint`} className="at-hint">
          {hint}
        </span>
      ) : null}
    </div>
  );
}

/** The keyboard a phone shows for the field: the one of a phone number, or the one of digits. */
function lineInputMode(field: CustomDataFieldDef): InputProps["inputMode"] {
  if (field.type === "phone") return "tel";
  return field.rules?.digits_only ? "numeric" : undefined;
}

/** A short answer, and a phone number: a line of text, with what the field asks for under it. A phone number takes only what a
 * number is written with. */
function LineInput({ field, value, disabled, onChange }: Readonly<CustomDataFieldInputProps>) {
  const isPhone = field.type === "phone";
  return (
    <Input
      label={customDataFieldLabel(field)}
      value={value}
      disabled={disabled}
      required={field.required}
      hint={answerHint(field)}
      type={isPhone ? "tel" : undefined}
      inputMode={lineInputMode(field)}
      maxLength={isPhone ? CONTACT_PHONE_MAX_LENGTH : undefined}
      onChange={(e) => onChange(isPhone ? sanitizeContactPhoneInput(e.target.value, true) : e.target.value)}
      {...(isPhone ? attendeeFieldAttrs(`custom-field-${field.source_field}`) : {})}
    />
  );
}

/** Render one event-item custom_data field with type-aware controls. */
export function CustomDataFieldInput(props: Readonly<CustomDataFieldInputProps>) {
  const { field, value, disabled, onChange } = props;
  const label = customDataFieldLabel(field);
  const type = field.type ?? "text";
  const fieldId = `custom-field-${field.source_field}`;

  if (type === "select") {
    const placeholder = field.required ? "Choose…" : "-";
    return (
      <div className="at-field">
        <label className="at-label" htmlFor={fieldId}>
          {label}
        </label>
        <SearchableSelect
          id={fieldId}
          label={label}
          placeholder={placeholder}
          searchPlaceholder="Search options…"
          emptyLabel="No options found"
          showLabel={false}
          value={value}
          disabled={disabled}
          options={[
            { id: "", label: placeholder },
            ...(field.options ?? []).map((option) => ({ id: option, label: option })),
          ]}
          onChange={onChange}
        />
      </div>
    );
  }

  if (type === "boolean") {
    const placeholder = field.required ? "Choose…" : "-";
    return (
      <div className="at-field">
        <label className="at-label" htmlFor={fieldId}>
          {label}
        </label>
        <SearchableSelect
          id={fieldId}
          label={label}
          placeholder={placeholder}
          searchPlaceholder="Search options…"
          emptyLabel="No options found"
          showLabel={false}
          value={value}
          disabled={disabled}
          options={[
            { id: "", label: placeholder },
            { id: "true", label: "Yes" },
            { id: "false", label: "No" },
          ]}
          onChange={onChange}
        />
      </div>
    );
  }

  if (type === "long_text") return <LongTextInput {...props} />;
  if (type === "datetime") return <DateTimeInput {...props} />;
  // A field that asks for digits only has no + to take a country code, so it keeps the plain line.
  if (type === "phone" && !field.rules?.digits_only) return <PhoneInput {...props} />;
  if (type === "date") {
    return (
      <DatePicker
        id={fieldId}
        label={field.label}
        required={field.required}
        value={value}
        disabled={disabled}
        onChange={onChange}
      />
    );
  }
  return <LineInput {...props} />;
}
