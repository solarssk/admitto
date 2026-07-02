import { useEffect, useState } from "react";
import { Spinner, useToast } from "@admitto/ui";
import { ApiError, fetchSetupChecks } from "../../api/client.js";
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

export function WizardStep1Checks({ onChecksOk }: WizardStep1ChecksProps) {
  const { addToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [checks, setChecks] = useState<SetupChecksResponse["checks"] | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    setLoading(true);
    void (async () => {
      try {
        const data = await fetchSetupChecks(ac.signal);
        if (ac.signal.aborted) return;
        setChecks(data.checks);
      } catch (err) {
        if (ac.signal.aborted) return;
        addToast(err instanceof ApiError ? err.message : "Failed to load system checks.", "error");
        setChecks(null);
      } finally {
        if (!ac.signal.aborted) setLoading(false);
      }
    })();
    return () => ac.abort();
  }, [addToast]);

  const allOk = checks ? SETUP_CHECK_ORDER.every((key) => checks[key].ok) : false;

  useEffect(() => {
    onChecksOk(allOk);
  }, [allOk, onChecksOk]);

  return (
    <>
      <h2 className="setup-wizard__card-title">System check</h2>
      <p className="setup-wizard__card-desc">
        Verify prerequisites before configuring your instance. All checks must pass to continue.
      </p>

      {loading && (
        <div role="status" style={{ textAlign: "center", padding: "1.5rem 0" }}>
          <Spinner label="Running system checks" />
        </div>
      )}

      {!loading && checks && (
        <div className="setup-wizard__checks">
          {SETUP_CHECK_ORDER.map((key) => (
            <CheckRow key={key} checkKey={key} result={checks[key]} />
          ))}
        </div>
      )}

      {!loading && !checks && (
        <p className="setup-wizard__hint" role="alert">
          Could not load system checks. Refresh the page to try again.
        </p>
      )}
    </>
  );
}

function CheckRow({
  checkKey,
  result,
}: {
  checkKey: SetupCheckKey;
  result: { ok: boolean; detail: string; warn?: boolean };
}) {
  const iconClass = result.warn
    ? "ti ti-alert-circle setup-wizard__check-icon is-warn"
    : result.ok
      ? "ti ti-circle-check setup-wizard__check-icon is-ok"
      : "ti ti-circle-x setup-wizard__check-icon is-error";

  return (
    <div className="setup-wizard__check-row">
      <i className={iconClass} aria-hidden="true" />
      <div className="setup-wizard__check-body">
        <p
          className={`setup-wizard__check-title${
            result.warn ? " is-warn" : result.ok ? " is-ok" : ""
          }`}
        >
          {SETUP_CHECK_LABELS[checkKey]}
        </p>
        <p className="setup-wizard__check-detail">{result.detail}</p>
        {!result.ok && (
          <details className="setup-wizard__fix">
            <summary>How to fix</summary>
            <pre>{checkFixHint(checkKey)}</pre>
          </details>
        )}
      </div>
    </div>
  );
}
