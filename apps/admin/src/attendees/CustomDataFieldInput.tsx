import { Input, Select } from "@admitto/ui";
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

  if (type === "select") {
    return (
      <Select
        label={label}
        value={value}
        disabled={disabled}
        required={field.required}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">{field.required ? "Choose…" : "-"}</option>
        {(field.options ?? []).map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </Select>
    );
  }

  if (type === "boolean") {
    return (
      <Select
        label={label}
        value={value}
        disabled={disabled}
        required={field.required}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">{field.required ? "Choose…" : "-"}</option>
        <option value="true">Yes</option>
        <option value="false">No</option>
      </Select>
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
