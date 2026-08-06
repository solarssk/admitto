import { Input } from "@admitto/ui";
import { SearchableSelect } from "../components/SearchableSelect.js";
import { customDataFieldLabel, type CustomDataFieldDef } from "./customData.js";

export interface CustomDataFieldInputProps {
  field: CustomDataFieldDef;
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}

/** Render one event-item custom_data field with type-aware controls. */
export function CustomDataFieldInput({
  field,
  value,
  disabled,
  onChange,
}: Readonly<CustomDataFieldInputProps>) {
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

  return (
    <Input
      label={label}
      value={value}
      disabled={disabled}
      required={field.required}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
