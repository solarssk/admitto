import { Skeleton } from "@admitto/ui";

type CkStatsProps = {
  admitted: number;
  total: number;
  /** The counts have not arrived: their places show a placeholder instead of a misleading "0 / 0". */
  loading?: boolean;
  /** The placeholder is in the page but not painted yet (the loading gate's 200ms), so its space is reserved. */
  held?: boolean;
};

export function CkStats({ admitted, total, loading = false, held = false }: Readonly<CkStatsProps>) {
  const pct = total > 0 ? Math.round((admitted / total) * 100) : 0;

  return (
    <div className={`ck-stats${loading && held ? " at-loading-hold" : ""}`} aria-busy={loading || undefined}>
      {/* Mockup ci-stats-row: number columns with labels beneath, percent flush right. */}
      <div className="ck-stats__row">
        <div className="ck-stats__stat">
          <span className="ck-stats__admitted">{loading ? <Skeleton variant="rect" width={44} height="1em" /> : admitted}</span>
          <span className="ck-stats__lbl">admitted</span>
        </div>
        <span className="ck-stats__sep">/</span>
        <div className="ck-stats__stat">
          <span className="ck-stats__total">{loading ? <Skeleton variant="rect" width={44} height="1em" /> : total}</span>
          <span className="ck-stats__lbl">expected</span>
        </div>
        <span className="ck-stats__pct">{loading ? <Skeleton variant="rect" width={48} height={22} /> : `${pct}%`}</span>
      </div>
      {loading ? (
        <progress className="ck-progress" value={0} max={100} aria-hidden="true" />
      ) : (
        <progress
          className="ck-progress"
          value={pct}
          max={100}
          aria-label={`${pct}% of expected guests admitted`}
        />
      )}
    </div>
  );
}
