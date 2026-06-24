import type { CheckInHistoryEntry } from "../api/types.js";
import { CkRecentScans } from "./CkRecentScans.js";
import { CkStats } from "./CkStats.js";

/** Max rows in the main check-in sidebar (prompt 50). Overlay uses its own cap. */
export const CK_RECENT_SCANS_SIDEBAR_LIMIT = 8;

type ScanHistoryListProps = {
  admittedCount: number;
  totalCount: number;
  history: CheckInHistoryEntry[];
  compact?: boolean;
};

export function ScanHistoryList({
  admittedCount,
  totalCount,
  history,
  compact = false,
}: ScanHistoryListProps) {
  return (
    <>
      <CkStats admitted={admittedCount} total={totalCount} />
      <CkRecentScans
        history={history}
        compact={compact}
        limit={compact ? 3 : CK_RECENT_SCANS_SIDEBAR_LIMIT}
      />
    </>
  );
}
