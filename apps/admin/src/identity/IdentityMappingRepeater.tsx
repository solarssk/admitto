import { useEffect, useState } from "react";
import { Button, Input } from "@admitto/ui";
import { fetchAdminEvents, fetchAdminOrganizations } from "../api/client.js";
import { SearchableSelect, type SearchableSelectOption } from "../components/SearchableSelect.js";
import {
  MAPPING_ROLES,
  withScopeForRole,
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
  const [events, setEvents] = useState<SearchableSelectOption[]>([]);
  const [organizations, setOrganizations] = useState<SearchableSelectOption[]>([]);
  const [scopeOptionsLoading, setScopeOptionsLoading] = useState(true);

  // Populates the Event/Organization pickers below with real, existing rows - scope_id used to
  // be a free-text field with no existence check (validateMappingRow only checks length), so a
  // typo silently saved a mapping that could never match any real user's grant. Failure here
  // degrades to an empty picker (still usable via the current-value fallback option below), not
  // a blocked modal - this list is a convenience, not a save-blocking dependency.
  useEffect(() => {
    const controller = new AbortController();
    Promise.all([fetchAdminEvents({ signal: controller.signal }), fetchAdminOrganizations(controller.signal)])
      .then(([eventList, organizationList]) => {
        setEvents(eventList.map((e) => ({ id: e.id, label: e.title, icon: "calendar-event" })));
        setOrganizations(organizationList.map((o) => ({ id: o.id, label: o.name, icon: "building" })));
      })
      .catch(() => {
        /* picker still works via the current-value fallback option; Save is unaffected */
      })
      .finally(() => setScopeOptionsLoading(false));
    return () => controller.abort();
  }, []);

  const updateRow = (index: number, patch: Partial<MappingRow>) => {
    onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };

  /** Role determines scope - see scopeForRole. Changing role re-derives scope_type (and clears
   * scope_id when the new scope no longer takes one) in the same update. */
  const updateRole = (index: number, role: MappingRow["role"]) => {
    onChange(rows.map((row, i) => (i === index ? withScopeForRole({ ...row, role }) : row)));
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
        const roleErrorId = rowError.role ? `identity-mapping-role-${row.id}-error` : undefined;
        const scopeErrorId = rowError.scope_type ? `identity-mapping-scope-${row.id}-error` : undefined;
        return (
          <div
            className={`identity-mappings__row${needsScopeId ? " identity-mappings__row--with-scope-id" : ""}`}
            key={row.id}
          >
            <Input
              label="Group"
              value={row.group}
              invalid={Boolean(rowError.group)}
              error={rowError.group}
              onChange={(e) => updateRow(index, { group: e.target.value })}
              placeholder="admins"
            />
            <div>
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
                  invalid={Boolean(rowError.role)}
                  describedBy={roleErrorId}
                  options={[
                    ...(roleInvalid ? [{ id: row.role, label: `${row.role} (invalid, pick a role)` }] : []),
                    ...MAPPING_ROLES.map((role) => ({ id: role, label: role })),
                  ]}
                  onChange={(id) => updateRole(index, id as MappingRow["role"])}
                />
              </div>
              {rowError.role && (
                <span id={roleErrorId} className="at-hint at-hint--error">{rowError.role}</span>
              )}
            </div>
            <div>
              <div className="at-field">
                <label className="at-label" htmlFor={`identity-mapping-scope-${row.id}`}>
                  Scope
                </label>
                <SearchableSelect
                  id={`identity-mapping-scope-${row.id}`}
                  label="Scope"
                  placeholder=""
                  searchPlaceholder=""
                  emptyLabel=""
                  showLabel={false}
                  value={row.scope_type}
                  disabled
                  title={`Set by the ${row.role} role - a mapping's scope always matches its role.`}
                  describedBy={scopeErrorId}
                  options={[{ id: row.scope_type, label: row.scope_type }]}
                  onChange={() => {}}
                />
              </div>
              {rowError.scope_type && (
                <span id={scopeErrorId} className="at-hint at-hint--error">{rowError.scope_type}</span>
              )}
            </div>
            {needsScopeId && (() => {
              const isOrg = row.scope_type === "organization";
              const fieldLabel = isOrg ? "Organization" : "Event";
              const scopeIdOptions = isOrg ? organizations : events;
              const currentKnown = !row.scope_id || scopeIdOptions.some((o) => o.id === row.scope_id);
              const scopeIdErrorId = rowError.scope_id
                ? `identity-mapping-scope-id-${row.id}-error`
                : undefined;
              return (
                <div>
                  <div className="at-field">
                    <label className="at-label" htmlFor={`identity-mapping-scope-id-${row.id}`}>
                      {fieldLabel}
                    </label>
                    <SearchableSelect
                      id={`identity-mapping-scope-id-${row.id}`}
                      label={fieldLabel}
                      placeholder={`Select ${fieldLabel.toLowerCase()}…`}
                      searchPlaceholder={`Search ${fieldLabel.toLowerCase()}s…`}
                      emptyLabel={
                        scopeOptionsLoading ? "Loading…" : `No ${fieldLabel.toLowerCase()}s found`
                      }
                      showLabel={false}
                      value={row.scope_id}
                      invalid={Boolean(rowError.scope_id)}
                      describedBy={scopeIdErrorId}
                      options={[
                        ...(currentKnown ? [] : [{ id: row.scope_id, label: `${row.scope_id} (not found)` }]),
                        ...scopeIdOptions,
                      ]}
                      onChange={(id) => updateRow(index, { scope_id: id })}
                    />
                  </div>
                  {rowError.scope_id && (
                    <span id={scopeIdErrorId} className="at-hint at-hint--error">
                      {rowError.scope_id}
                    </span>
                  )}
                </div>
              );
            })()}
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
