import { Button, Input, Select } from "@admitto/ui";
import {
  MAPPING_ROLES,
  MAPPING_SCOPES,
  emptyMappingRow,
  type MappingRow,
  type MappingRowError,
} from "./identityProviderValidation.js";

interface IdentityMappingRepeaterProps {
  rows: MappingRow[];
  errors: MappingRowError[];
  onChange: (rows: MappingRow[]) => void;
}

/** Group → role mapping repeater (#266 slice 3b). Replace-all semantics: the
 *  editor always sends the full list on save (the slice-1 PUT contract requires
 *  `mappings` on every request). Empty list = no SSO group grants. */
export function IdentityMappingRepeater({ rows, errors, onChange }: IdentityMappingRepeaterProps) {
  const updateRow = (index: number, patch: Partial<MappingRow>) => {
    onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };

  const removeRow = (index: number) => {
    onChange(rows.filter((_, i) => i !== index));
  };

  const addRow = () => {
    onChange([...rows, emptyMappingRow()]);
  };

  return (
    <div className="identity-mappings">
      {rows.length === 0 && (
        <p className="identity-mappings__empty">
          No mappings yet. SSO users will sign in but receive no role until you add a group → role
          mapping.
        </p>
      )}

      {rows.map((row, index) => {
        const rowError = errors[index] ?? {};
        const needsScopeId = row.scope_type !== "instance";
        return (
          <div className="identity-mappings__row" key={index}>
            <Input
              label="Group"
              value={row.group}
              invalid={Boolean(rowError.group)}
              error={rowError.group}
              onChange={(e) => updateRow(index, { group: e.target.value })}
              placeholder="admins"
            />
            <Select
              label="Role"
              value={row.role}
              onChange={(e) => updateRow(index, { role: e.target.value as MappingRow["role"] })}
            >
              {MAPPING_ROLES.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </Select>
            <Select
              label="Scope"
              value={row.scope_type}
              onChange={(e) =>
                updateRow(index, {
                  scope_type: e.target.value as MappingRow["scope_type"],
                  scope_id: e.target.value === "instance" ? "" : row.scope_id,
                })
              }
            >
              {MAPPING_SCOPES.map((scope) => (
                <option key={scope} value={scope}>
                  {scope}
                </option>
              ))}
            </Select>
            {needsScopeId ? (
              <Input
                label={row.scope_type === "organization" ? "Organization ID" : "Event ID"}
                value={row.scope_id}
                invalid={Boolean(rowError.scope_id)}
                error={rowError.scope_id}
                onChange={(e) => updateRow(index, { scope_id: e.target.value })}
                placeholder={row.scope_type === "organization" ? "org-uuid" : "event-uuid"}
              />
            ) : (
              <div className="identity-mappings__cell identity-mappings__cell--hidden" />
            )}
            <div className="identity-mappings__cell identity-mappings__remove">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => removeRow(index)}
                aria-label="Remove mapping"
              >
                Remove
              </Button>
            </div>
          </div>
        );
      })}

      <div className="identity-mappings__add">
        <Button type="button" variant="secondary" onClick={addRow}>
          Add mapping
        </Button>
      </div>
    </div>
  );
}
