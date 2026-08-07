import { Button, Input } from "@admitto/ui";
import { SearchableSelect } from "../components/SearchableSelect.js";
import {
  MAPPING_ROLES,
  MAPPING_SCOPES,
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
export function IdentityMappingRepeater({
  rows,
  errors,
  onChange,
}: Readonly<IdentityMappingRepeaterProps>) {
  const updateRow = (index: number, patch: Partial<MappingRow>) => {
    onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };

  const removeRow = (index: number) => {
    onChange(rows.filter((_, i) => i !== index));
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
        const roleInvalid = !MAPPING_ROLES.includes(row.role);
        const scopeInvalid = !MAPPING_SCOPES.includes(row.scope_type);
        return (
          <div className="identity-mappings__row" key={row.id}>
            <div className="identity-mappings__cell identity-mappings__cell--group">
              <Input
                label="Group"
                value={row.group}
                invalid={Boolean(rowError.group)}
                error={rowError.group}
                onChange={(e) => updateRow(index, { group: e.target.value })}
                placeholder="admins"
              />
            </div>
            <div className="identity-mappings__cell">
              <div className="at-field">
                <label className="at-label" htmlFor={`identity-mapping-role-${row.id}`}>
                  Role
                </label>
                <SearchableSelect
                  id={`identity-mapping-role-${row.id}`}
                  label="Role"
                  placeholder="Select role…"
                  searchPlaceholder="Search roles…"
                  emptyLabel="No roles found"
                  showLabel={false}
                  value={row.role}
                  options={[
                    ...(roleInvalid ? [{ id: row.role, label: `${row.role} (invalid, pick a role)` }] : []),
                    ...MAPPING_ROLES.map((role) => ({ id: role, label: role })),
                  ]}
                  onChange={(id) => updateRow(index, { role: id as MappingRow["role"] })}
                />
              </div>
              {rowError.role && (
                <span className="at-hint at-hint--error">{rowError.role}</span>
              )}
            </div>
            <div className="identity-mappings__cell">
              <div className="at-field">
                <label className="at-label" htmlFor={`identity-mapping-scope-${row.id}`}>
                  Scope
                </label>
                <SearchableSelect
                  id={`identity-mapping-scope-${row.id}`}
                  label="Scope"
                  placeholder="Select scope…"
                  searchPlaceholder="Search scopes…"
                  emptyLabel="No scopes found"
                  showLabel={false}
                  value={row.scope_type}
                  options={[
                    ...(scopeInvalid ? [{ id: row.scope_type, label: `${row.scope_type} (invalid, pick a scope)` }] : []),
                    ...MAPPING_SCOPES.map((scope) => ({ id: scope, label: scope })),
                  ]}
                  onChange={(id) =>
                    updateRow(index, {
                      scope_type: id as MappingRow["scope_type"],
                      scope_id: id === "instance" ? "" : row.scope_id,
                    })
                  }
                />
              </div>
              {rowError.scope_type && (
                <span className="at-hint at-hint--error">{rowError.scope_type}</span>
              )}
            </div>
            {needsScopeId && (
              <div className="identity-mappings__cell">
                <Input
                  label={row.scope_type === "organization" ? "Organization ID" : "Event ID"}
                  value={row.scope_id}
                  invalid={Boolean(rowError.scope_id)}
                  error={rowError.scope_id}
                  onChange={(e) => updateRow(index, { scope_id: e.target.value })}
                  placeholder={row.scope_type === "organization" ? "org-uuid" : "event-uuid"}
                />
              </div>
            )}
            <div className="identity-mappings__remove">
              <Button
                type="button"
                variant="ghost"
                onClick={() => removeRow(index)}
                aria-label="Remove mapping"
              >
                Remove
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
