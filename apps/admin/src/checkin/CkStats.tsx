type CkStatsProps = {
  admitted: number;
  total: number;
};

export function CkStats({ admitted, total }: CkStatsProps) {
  const pct = total > 0 ? Math.round((admitted / total) * 100) : 0;

  return (
    <div className="ck-stats">
      {/* Mockup ci-stats-row: number columns with labels beneath, percent flush right. */}
      <div className="ck-stats__row">
        <div className="ck-stats__stat">
          <span className="ck-stats__admitted">{admitted}</span>
          <span className="ck-stats__lbl">admitted</span>
        </div>
        <span className="ck-stats__sep">/</span>
        <div className="ck-stats__stat">
          <span className="ck-stats__total">{total}</span>
          <span className="ck-stats__lbl">expected</span>
        </div>
        <span className="ck-stats__pct">{pct}%</span>
      </div>
      <div
        className="ck-progress"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${pct}% of expected guests admitted`}
      >
        <div className="ck-progress__fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
