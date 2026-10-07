import { useCallback, useEffect } from "react";
import { Skeleton } from "@admitto/ui";
import { fetchSetupChecks } from "../../api/client.js";
import type { SetupChecksResponse } from "../../api/types.js";
import { RefetchRegion } from "../../components/RefetchRegion.js";
import { RefreshWarning } from "../../components/RefreshWarning.js";
import { useCardLoad } from "../../hooks/useCardLoad.js";
import { useMinimumBusy } from "../../hooks/useDelayedLoading.js";
import { useListLoad } from "../../hooks/useListLoad.js";
import { assertPresent } from "../../utils/assert-present.js";
import {
  SETUP_CHECK_LABELS,
  SETUP_CHECK_ORDER,
  checkFixHint,
  type SetupCheckKey,
} from "./checkFixHints.js";
import { WizardRetryNotice, WizardStepPlaceholder } from "./WizardStepLoad.js";

type WizardStep1ChecksProps = {
  onChecksOk: (ok: boolean) => void;
};

type CheckResult = SetupChecksResponse["checks"][SetupCheckKey];

/**
 * The system checks of the first step. The first run draws the rows with their real labels and a placeholder for each
 * result (invisible for the first 200ms), says it is taking longer than usual after 8 seconds, and ends in an error with a
 * Retry after 30; a Retry of a run that did not pass runs the checks again with the results on screen, blocked and dimmed,
 * until the new ones are in (a run that fails keeps them and says so). A read that failed is not a list of checks: the step
 * is not ready then, and nothing is shown as passed.
 */
export function WizardStep1Checks({ onChecksOk }: Readonly<WizardStep1ChecksProps>) {
  const fetchChecks = useCallback(async (signal: AbortSignal) => (await fetchSetupChecks(signal)).checks, []);
  const list = useListLoad({ fetcher: fetchChecks, fallback: "Could not load system checks." });
  const card = useCardLoad(list);
  const rerunning = useMinimumBusy(list.refreshing);
  const checks = list.error === null ? list.data : null;

  const allOk = checks ? SETUP_CHECK_ORDER.every((key) => checks[key].ok) : false;
  const hasCheckErrors = checks ? SETUP_CHECK_ORDER.some((key) => !checks[key].ok) : false;

  useEffect(() => {
    onChecksOk(allOk);
  }, [allOk, onChecksOk]);

  let body;
  if (!card.gate.showContent) {
    body = (
      <WizardStepPlaceholder label="Running the system checks" held={!card.gate.showIndicator} slow={card.slow}>
        <ul className="setup-wizard__check-list">
          {SETUP_CHECK_ORDER.map((key) => (
            <CheckRowPlaceholder key={key} checkKey={key} />
          ))}
        </ul>
      </WizardStepPlaceholder>
    );
  } else if (card.failure.error) {
    body = (
      <WizardRetryNotice
        className="setup-wizard__check-error-banner"
        retrying={card.failure.retrying}
        onRetry={card.failure.retry}
      >
        {card.failure.error}
      </WizardRetryNotice>
    );
  } else {
    // Past the placeholder and the error, the read has answered.
    assertPresent(checks);
    body = (
      <RefetchRegion refreshing={list.refreshing} label="Running the checks again">
        <ul className="setup-wizard__check-list">
          {SETUP_CHECK_ORDER.map((key) => (
            <CheckRow key={key} checkKey={key} result={checks[key]} />
          ))}
        </ul>
        {list.refreshError ? <RefreshWarning message={list.refreshError} onRetry={list.reload} /> : null}
        {hasCheckErrors && (
          <WizardRetryNotice
            className="setup-wizard__check-error-banner"
            retryClassName="setup-wizard__check-retry"
            retrying={rerunning}
            onRetry={list.reload}
          >
            Fix the issues above, then use Retry to run checks again.
          </WizardRetryNotice>
        )}
      </RefetchRegion>
    );
  }

  return (
    <>
      <p className="setup-wizard__step-sub">Verifying all prerequisites before first use.</p>
      {body}
    </>
  );
}

/** A row of the run that has not answered yet: the real label, and the shapes of the icon and the detail. */
function CheckRowPlaceholder({ checkKey }: Readonly<{ checkKey: SetupCheckKey }>) {
  return (
    <li className="setup-wizard__check-item setup-wizard__check-item--pending">
      <span className="setup-wizard__check-item-icon">
        <Skeleton variant="circle" width={16} height={16} />
      </span>
      <div className="setup-wizard__check-item-main">
        <span className="setup-wizard__check-item-label">{SETUP_CHECK_LABELS[checkKey]}</span>
      </div>
      <span className="setup-wizard__check-item-detail">
        <Skeleton variant="rect" width={96} height={14} />
      </span>
    </li>
  );
}

function CheckRow({
  checkKey,
  result,
}: Readonly<{
  checkKey: SetupCheckKey;
  result: CheckResult;
}>) {
  const isError = !result.ok;
  const isWarn = result.ok && !!result.warn;

  const itemClass = [
    "setup-wizard__check-item",
    isError ? "setup-wizard__check-item--error" : "",
    isWarn ? "setup-wizard__check-item--warn" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <li className={itemClass}>
      <span className="setup-wizard__check-item-icon" aria-hidden="true">
        {isError && <i className="ti ti-circle-x" />}
        {!isError && isWarn && <i className="ti ti-alert-circle" />}
        {!isError && !isWarn && <i className="ti ti-circle-check" />}
      </span>
      <div className="setup-wizard__check-item-main">
        <span className="setup-wizard__check-item-label">{SETUP_CHECK_LABELS[checkKey]}</span>
        {isError && (
          <div className="setup-wizard__check-item-fix">
            <p className="setup-wizard__check-item-err">{result.detail}</p>
            <p className="setup-wizard__check-item-hint">{checkFixHint(checkKey)}</p>
          </div>
        )}
      </div>
      <span className="setup-wizard__check-item-detail">
        {isError ? "Failed" : result.detail}
      </span>
    </li>
  );
}
