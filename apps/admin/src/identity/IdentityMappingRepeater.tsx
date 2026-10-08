import { Button, Input } from "@admitto/ui";
import { RetryHint } from "../components/RetryHint.js";
import { SearchableSelect, type SearchableSelectOption } from "../components/SearchableSelect.js";
import { useEventOptions } from "../hooks/useEventOptions.js";
import { lookupReady, type OptionsLoad } from "../hooks/useOptionsLoad.js";
import { useOrganizationOptions } from "../hooks/useOrganizationOptions.js";
import { LookupSlot } from "../pages/users/LookupSlot.js";
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

type ScopeLookup = Pick<OptionsLoad<unknown>, "loading" | "error" | "retry" | "retrying" | "slow">;

/** The option that keeps a stored scope id visible when the list does not hold it: its name is not known while the
 * lookup is on its way or failed (so it says what kind of scope it is, never "not found"), and only an answer that does
 * not hold the id calls it not found (a since-deleted event). */
function unknownScopeOption(
  scopeId: string,
  options: SearchableSelectOption[],
  lookup: ScopeLookup,
  fieldLabel: string,
): SearchableSelectOption[] {
  if (!scopeId || options.some((o) => o.id === scopeId)) return [];
  return [{ id: scopeId, label: lookupReady(lookup) ? `${scopeId} (not found)` : fieldLabel }];
}

/** Group → role mapping repeater (#266 slice 3b). Replace-all semantics: the
 *  editor always sends the full list on save (the slice-1 PUT contract requires
 *  `mappings` on every request). Empty list = no SSO group grants. */
export function IdentityMappingRepeater({
  rows,
  errors,
  onChange,
}: Readonly<IdentityMappingRepeaterProps>) {
  // Populates the Event/Organization pickers below with real, existing rows - scope_id used to
  // be a free-text field with no existence check (validateMappingRow only checks length), so a
  // typo silently saved a mapping that could never match any real user's grant. A lookup is read
  // only while a row needs it. A failure is said once under the rows, with a Retry that reruns that lookup
  // only (the rows being edited are not touched), and turns the picker off; Save is unaffected, and a stored
  // scope still shows as what kind of scope it is.
  const needsEvents = rows.some((row) => row.scope_type === "event");
  const needsOrganizations = rows.some((row) => row.scope_type === "organization");
  // The lookups are read after the editor's record, so the session can have ended by then: a 401 is the login page, not a
  // Retry that cannot mend it.
  const eventLookup = useEventOptions({ includeArchived: false, enabled: needsEvents, redirectOnUnauthorized: true });
  const organizationLookup = useOrganizationOptions(needsOrganizations, { redirectOnUnauthorized: true });
  const eventOptions: SearchableSelectOption[] = eventLookup.events.map((e) => ({ id: e.id, label: e.title, icon: "calendar-event" }));
  const organizationOptions: SearchableSelectOption[] = organizationLookup.organizations.map((o) => ({
    id: o.id,
    label: o.name,
    icon: "building",
  }));

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
            {needsScopeId && (
              <ScopeIdField
                row={row}
                error={rowError.scope_id}
                lookup={row.scope_type === "organization" ? organizationLookup : eventLookup}
                options={row.scope_type === "organization" ? organizationOptions : eventOptions}
                onPick={(id) => updateRow(index, { scope_id: id })}
              />
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

      {needsEvents && eventLookup.error && (
        <RetryHint message={eventLookup.error} busy={eventLookup.retrying} onRetry={eventLookup.retry} retryLabel="Retry loading events" />
      )}
      {needsOrganizations && organizationLookup.error && (
        <RetryHint
          message={organizationLookup.error}
          busy={organizationLookup.retrying}
          onRetry={organizationLookup.retry}
          retryLabel="Retry loading organizations"
        />
      )}
    </div>
  );
}

/** The Event or Organization picker of a row whose role needs a scope id: a placeholder with the field's room while its
 * lookup's first request is on its way, the picker after, and off when the lookup failed (the Retry is under the rows). */
function ScopeIdField({
  row,
  error,
  lookup,
  options,
  onPick,
}: Readonly<{
  row: MappingRow;
  error: string | undefined;
  lookup: ScopeLookup;
  options: SearchableSelectOption[];
  onPick: (id: string) => void;
}>) {
  const isOrg = row.scope_type === "organization";
  const fieldLabel = isOrg ? "Organization" : "Event";
  const errorId = error ? `identity-mapping-scope-id-${row.id}-error` : undefined;
  // The error of a Save pressed before the lookup has answered is outside the slot, so it is not hidden by the placeholder.
  return (
    <div>
      <LookupSlot lookup={lookup} label={isOrg ? "organizations" : "events"} showHint={false}>
        <div className="at-field">
          <label className="at-label" htmlFor={`identity-mapping-scope-id-${row.id}`}>
            {fieldLabel}
          </label>
          <SearchableSelect
            id={`identity-mapping-scope-id-${row.id}`}
            label={fieldLabel}
            placeholder={lookup.error ? `Could not load ${fieldLabel.toLowerCase()}s` : `Select ${fieldLabel.toLowerCase()}…`}
            searchPlaceholder={`Search ${fieldLabel.toLowerCase()}s…`}
            emptyLabel={`No ${fieldLabel.toLowerCase()}s found`}
            showLabel={false}
            value={row.scope_id}
            invalid={Boolean(error)}
            describedBy={errorId}
            disabled={lookup.error !== null}
            options={[...unknownScopeOption(row.scope_id, options, lookup, fieldLabel), ...options]}
            onChange={onPick}
          />
        </div>
      </LookupSlot>
      {error && (
        <span id={errorId} className="at-hint at-hint--error">
          {error}
        </span>
      )}
    </div>
  );
}
