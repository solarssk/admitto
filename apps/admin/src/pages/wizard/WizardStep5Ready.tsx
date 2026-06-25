import { useState } from "react";
import { Button, useToast } from "@admitto/ui";
import { useNavigate } from "react-router-dom";
import { ApiError, completeSetup } from "../../api/client.js";
import { useWizard } from "./WizardContext.js";

type WizardStep5ReadyProps = {
  onComplete: () => Promise<void>;
};

export function WizardStep5Ready({ onComplete }: WizardStep5ReadyProps) {
  const { addToast } = useToast();
  const navigate = useNavigate();
  const { summary, selectedEventId } = useWizard();
  const [submitting, setSubmitting] = useState(false);

  const handleGoToDashboard = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await completeSetup();
      await onComplete();
      if (selectedEventId) {
        navigate(`/admin/events/${selectedEventId}/overview`, { replace: true });
      } else {
        navigate("/admin", { replace: true });
      }
    } catch (err) {
      addToast(err instanceof ApiError ? err.message : "Failed to complete setup.", "error");
      setSubmitting(false);
    }
  };

  return (
    <>
      <div className="setup-wizard__ready-icon" aria-hidden="true">
        <i className="ti ti-check" />
      </div>
      <h2 className="setup-wizard__ready-title">Instance ready!</h2>
      <p className="setup-wizard__ready-desc">
        Admitto is configured and ready for your first event.
      </p>

      <div className="setup-wizard__summary">
        <div className="setup-wizard__summary-row">
          <span className="setup-wizard__summary-label">System checks</span>
          <span className="setup-wizard__summary-value is-ok">Passed</span>
        </div>
        <div className="setup-wizard__summary-row">
          <span className="setup-wizard__summary-label">Mail transport</span>
          <span className="setup-wizard__summary-value">{summary.mailLabel}</span>
        </div>
        <div className="setup-wizard__summary-row">
          <span className="setup-wizard__summary-label">Branding</span>
          <span className="setup-wizard__summary-value">{summary.brandingLabel}</span>
        </div>
        <div className="setup-wizard__summary-row">
          <span className="setup-wizard__summary-label">First event</span>
          <span className="setup-wizard__summary-value">
            {summary.eventTitle ?? "Not created"}
          </span>
        </div>
      </div>

      <div style={{ textAlign: "center" }}>
        <Button
          type="button"
          variant="primary"
          disabled={submitting}
          onClick={() => void handleGoToDashboard()}
        >
          {submitting ? "Finishing…" : "Go to dashboard →"}
        </Button>
      </div>
    </>
  );
}
