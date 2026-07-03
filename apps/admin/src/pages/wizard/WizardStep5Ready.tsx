import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useMemo,
  useState,
} from "react";
import { Button, useToast } from "@admitto/ui";
import { useNavigate } from "react-router-dom";
import { ApiError, completeSetup } from "../../api/client.js";
import { useWizard } from "./WizardContext.js";

type WizardStep5ReadyProps = {
  onComplete: () => Promise<void>;
  onGoToChecks: () => void;
  onSubmittingChange?: (submitting: boolean) => void;
};

export type WizardStep5ReadyHandle = {
  goToDashboard: () => Promise<void>;
};

type SummaryChip = {
  key: string;
  icon: string;
  label: string;
};

export const WizardStep5Ready = forwardRef<WizardStep5ReadyHandle, WizardStep5ReadyProps>(
  function WizardStep5Ready({ onComplete, onGoToChecks, onSubmittingChange }, ref) {
  const { addToast } = useToast();
  const navigate = useNavigate();
  const { summary, selectedEventId, mailSkipped, brandingSkipped } = useWizard();
  const [submitting, setSubmitting] = useState(false);
  const [checksNotReady, setChecksNotReady] = useState(false);

  const setBusy = (busy: boolean) => {
    setSubmitting(busy);
    onSubmittingChange?.(busy);
  };

  const chips = useMemo(() => {
    const items: SummaryChip[] = [
      { key: "system", icon: "ti-circle-check", label: "System checks passed" },
    ];

    if (!mailSkipped && summary.mailLabel !== "Skipped") {
      if (summary.mailLabel.startsWith("Configured")) {
        items.push({ key: "mail", icon: "ti-mail-check", label: "Mail transport configured" });
      } else if (summary.mailLabel === "Not configured") {
        items.push({ key: "mail", icon: "ti-mail", label: "Mail not configured" });
      } else {
        items.push({ key: "mail", icon: "ti-mail-check", label: summary.mailLabel });
      }
    }

    if (!brandingSkipped && summary.brandingLabel !== "Skipped") {
      items.push({
        key: "branding",
        icon: "ti-palette",
        label: `Branding: ${summary.brandingLabel}`,
      });
    }

    if (summary.eventTitle) {
      items.push({ key: "event", icon: "ti-calendar-event", label: summary.eventTitle });
    }

    return items;
  }, [brandingSkipped, mailSkipped, summary]);

  const goToDashboard = useCallback(async () => {
    if (submitting) return;
    setBusy(true);
    setChecksNotReady(false);
    try {
      await completeSetup();
      await onComplete();
      if (selectedEventId) {
        navigate(`/admin/events/${selectedEventId}/overview`, { replace: true });
      } else {
        navigate("/admin", { replace: true });
      }
    } catch (err) {
      if (
        err instanceof ApiError &&
        (err.code === "setup_not_ready" || err.message === "setup_not_ready")
      ) {
        setChecksNotReady(true);
        setBusy(false);
        return;
      }
      setChecksNotReady(false);
      const message =
        err instanceof ApiError ? err.message : "Failed to complete setup.";
      addToast(message, "error");
      setBusy(false);
    }
  }, [addToast, navigate, onComplete, selectedEventId, submitting]);

  useImperativeHandle(
    ref,
    () => ({
      goToDashboard,
    }),
    [goToDashboard],
  );

  return (
    <div className="setup-wizard__done">
      <div className="setup-wizard__done-icon" aria-hidden="true">
        <i className="ti ti-circle-check" />
      </div>
      <h2 className="setup-wizard__done-title">Admitto is ready</h2>
      <p className="setup-wizard__done-desc">
        Your instance is configured. Import attendees and send tickets from the dashboard.
      </p>

      <div className="setup-wizard__done-chips" aria-label="Setup summary">
        {chips.map((chip) => (
          <span key={chip.key} className="setup-wizard__done-chip">
            <i className={`ti ${chip.icon}`} aria-hidden="true" />
            <span className="setup-wizard__done-chip-label">{chip.label}</span>
          </span>
        ))}
      </div>

      {checksNotReady ? (
        <div className="setup-wizard__checks-error" role="alert">
          <p className="setup-wizard__hint">
            System checks are not passing yet. Review step 1 and fix any failed checks.
          </p>
          <Button type="button" variant="secondary" size="sm" onClick={onGoToChecks}>
            Review system checks
          </Button>
        </div>
      ) : null}
    </div>
  );
});
