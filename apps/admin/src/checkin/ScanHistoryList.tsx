import type { CheckInHistoryEntry } from "../api/types.js";
import { CkRecentScans } from "./CkRecentScans.js";
import { CkStats } from "./CkStats.js";

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
      <CkRecentScans history={history} compact={compact} limit={compact ? 3 : undefined} />
    </>
  );
}
