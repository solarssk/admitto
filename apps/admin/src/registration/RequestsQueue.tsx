import { Button } from "@admitto/ui";
import type { RegistrationCountsDto } from "../api/types.js";
import { Segmented, type SegmentedOption } from "../components/Segmented.js";
import type { MatchingTarget } from "./registrationDecisions.js";
import { requestsTotal, withCount, type RequestStatusFilter } from "./registrationRequests.js";
import "./registration-requests.css";

/**
 * The line under the toolbar: the shortcut to the work of the queue, "Waiting for a decision", with how many requests wait (the other
 * way is "All"; any other state is chosen in the Filters, and then neither is on), and, while a filter selects requests that can
 * be deleted together, the button that deletes them all. That button is about the filter, not about the rows that are ticked, so it
 * stands apart from the bulk bar and says how many it will take.
 */
export function RequestsQueue({
  status,
  counts,
  onStatusChange,
  matching,
  onDeleteMatching,
}: Readonly<{
  status: RequestStatusFilter;
  counts: RegistrationCountsDto | null;
  onStatusChange: (status: RequestStatusFilter) => void;
  /** What deleting everything the filter selects would take, or null when it cannot be offered. */
  matching: MatchingTarget | null;
  onDeleteMatching: () => void;
}>) {
  const options: SegmentedOption<RequestStatusFilter>[] = [
    { value: "pending", label: withCount("Waiting for a decision", counts?.needs_decision ?? null) },
    { value: "all", label: withCount("All", requestsTotal(counts)) },
  ];
  return (
    <div className="registration-requests__queue">
      <Segmented ariaLabel="Requests to show" options={options} value={status} onChange={onStatusChange} />
      {matching ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="registration-requests__delete-matching"
          icon={<i className="ti ti-trash" aria-hidden="true" />}
          onClick={onDeleteMatching}
        >
          {`Delete all matching (${matching.total})`}
        </Button>
      ) : null}
    </div>
  );
}
