import { useCallback, useEffect, useState } from "react";
import { Button } from "@admitto/ui";
import { ApiError, fetchSetupChecks } from "../../api/client.js";
import { operatorApiErrorMessage } from "../../api/operator-api-error.js";
import type { SetupChecksResponse } from "../../api/types.js";
import {
  SETUP_CHECK_LABELS,
  SETUP_CHECK_ORDER,
  checkFixHint,
  type SetupCheckKey,
} from "./checkFixHints.js";

type WizardStep1ChecksProps = {
  onChecksOk: (ok: boolean) => void;
};

type CheckResult = SetupChecksResponse["checks"][SetupCheckKey];

export function WizardStep1Checks({ onChecksOk }: WizardStep1ChecksProps) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [checks, setChecks] = useState<SetupChecksResponse["checks"] | null>(null);
  const [runNonce, setRunNonce] = useState(0);

  const retry = useCallback(() => {
    setChecks(null);
    setLoadError(null);
    onChecksOk(false);
    setRunNonce((n) => n + 1);
  }, [onChecksOk]);

  useEffect(() => {
    const ac = new AbortController();
    setLoading(true);
    setLoadError(null);
    void (async () => {
      try {
        const data = await fetchSetupChecks(ac.signal);
        if (ac.signal.aborted) return;
        setChecks(data.checks);
      } catch (err) {
        if (ac.signal.aborted) return;
        setLoadError(
          operatorApiErrorMessage(err, "Failed to load system checks."),
        );
        setChecks(null);
      } finally {
        if (!ac.signal.aborted) setLoading(false);
      }
    })();
    return () => ac.abort();
  }, [runNonce]);

  const allOk = checks ? SETUP_CHECK_ORDER.every((key) => checks[key].ok) : false;
  const hasCheckErrors = checks ? SETUP_CHECK_ORDER.some((key) => !checks[key].ok) : false;

  useEffect(() => {
    onChecksOk(allOk);
  }, [allOk, onChecksOk]);

  return (
    <>
      <p className="setup-wizard__step-sub">Verifying all prerequisites before first use.</p>

      {(loading || checks) && (
        <ul className="setup-wizard__check-list">
          {SETUP_CHECK_ORDER.map((key) => (
            <CheckRow
              key={key}
              checkKey={key}
              result={checks?.[key] ?? null}
              pending={loading}
            />
          ))}
        </ul>
      )}

      {!loading && checks && hasCheckErrors && (
        <div className="setup-wizard__check-error-banner" role="alert">
          <i className="ti ti-alert-triangle" aria-hidden="true" />
          <p>Fix the issues above, then use Retry to run checks again.</p>
          <Button type="button" variant="secondary" size="sm" onClick={retry} className="setup-wizard__check-retry">
            Retry
          </Button>
        </div>
      )}

      {!loading && loadError && (
        <div className="setup-wizard__checks-error" role="alert">
          <p className="setup-wizard__hint">{loadError}</p>
          <Button type="button" variant="secondary" size="sm" onClick={retry}>
            Retry
          </Button>
        </div>
      )}
    </>
  );
}

function CheckRow({
  checkKey,
  result,
  pending,
}: {
  checkKey: SetupCheckKey;
  result: CheckResult | null;
  pending: boolean;
}) {
  const isPending = pending || !result;
  const isError = !!result && !result.ok;
  const isWarn = !!result?.ok && !!result.warn;

  const itemClass = [
    "setup-wizard__check-item",
    isPending ? "setup-wizard__check-item--pending" : "",
    isError ? "setup-wizard__check-item--error" : "",
    isWarn ? "setup-wizard__check-item--warn" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <li className={itemClass}>
      <span className="setup-wizard__check-item-icon" aria-hidden="true">
        {isPending && <i className="ti ti-loader-2 setup-wizard__check-spin" />}
        {!isPending && isError && <i className="ti ti-circle-x" />}
        {!isPending && !isError && isWarn && <i className="ti ti-alert-circle" />}
        {!isPending && !isError && !isWarn && <i className="ti ti-circle-check" />}
      </span>
      <div className="setup-wizard__check-item-main">
        <span className="setup-wizard__check-item-label">{SETUP_CHECK_LABELS[checkKey]}</span>
        {isError && result && (
          <div className="setup-wizard__check-item-fix">
            <p className="setup-wizard__check-item-err">{result.detail}</p>
            <p className="setup-wizard__check-item-hint">{checkFixHint(checkKey)}</p>
          </div>
        )}
      </div>
      <span className="setup-wizard__check-item-detail">
        {isPending && "Checking…"}
        {!isPending && isError && "Failed"}
        {!isPending && !isError && result?.detail}
      </span>
    </li>
  );
}
