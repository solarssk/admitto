import { useRef } from "react";
import { Input } from "@admitto/ui";
import type { RegistrationCountsDto } from "../api/types.js";
import { FiltersMenu } from "../components/FiltersMenu.js";
import { SearchableSelect } from "../components/SearchableSelect.js";
import {
  REQUEST_AGE_SELECT_OPTIONS,
  isRequestAge,
  isRequestStatus,
  requestStatusOptions,
  type RequestAgeFilter,
  type RequestStatusFilter,
} from "./registrationRequests.js";
import "../attendees/attendees.css";

/** The search box and the Filters button of the request list: the same toolbar as the Attendees list, with the two filters of a request. */
export function RequestsToolbar({
  searchInput,
  onSearchChange,
  status,
  onStatusChange,
  age,
  onAgeChange,
  counts,
}: Readonly<{
  searchInput: string;
  onSearchChange: (value: string) => void;
  status: RequestStatusFilter;
  onStatusChange: (value: RequestStatusFilter) => void;
  age: RequestAgeFilter;
  onAgeChange: (value: RequestAgeFilter) => void;
  /** The numbers of each state, once known; the filter lists them beside each state. */
  counts: RegistrationCountsDto | null;
}>) {
  const searchInputRef = useRef<HTMLInputElement>(null);
  const activeFilterCount = (status === "all" ? 0 : 1) + (age === "any" ? 0 : 1);
  return (
    <div className="attendees-toolbar">
      <div className="attendees-toolbar__search">
        <Input
          ref={searchInputRef}
          id="registration-requests-search"
          name="registration-requests-search"
          aria-label="Search requests by name or email"
          placeholder="Name or email"
          value={searchInput}
          autoComplete="off"
          onChange={(event) => onSearchChange(event.target.value)}
          icon={<i className="ti ti-search" aria-hidden="true" />}
        />
        {searchInput.length > 0 && (
          <button
            type="button"
            className="attendees-toolbar__search-clear"
            aria-label="Clear search"
            onClick={() => {
              onSearchChange("");
              searchInputRef.current?.focus();
            }}
          >
            <i className="ti ti-x" aria-hidden="true" />
          </button>
        )}
      </div>
      <FiltersMenu activeCount={activeFilterCount} className="attendees-filters-menu">
        <div className="attendees-toolbar__filter">
          <SearchableSelect
            id="registration-requests-filter-status"
            label="Filter by status"
            placeholder="All statuses"
            searchPlaceholder="Search statuses…"
            emptyLabel="No statuses found"
            value={status}
            options={requestStatusOptions(counts)}
            onChange={(id) => onStatusChange(id === "all" || isRequestStatus(id) ? id : "all")}
            panelMode="inline"
          />
        </div>
        <div className="attendees-toolbar__filter">
          <SearchableSelect
            id="registration-requests-filter-age"
            label="Registered more than"
            placeholder="Any time"
            searchPlaceholder="Search…"
            emptyLabel="No options found"
            value={age}
            options={REQUEST_AGE_SELECT_OPTIONS}
            onChange={(id) => onAgeChange(isRequestAge(id) ? id : "any")}
            panelMode="inline"
          />
        </div>
      </FiltersMenu>
    </div>
  );
}
