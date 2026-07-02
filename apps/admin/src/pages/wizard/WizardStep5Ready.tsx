import { useMemo, useState } from "react";
import { Button, useToast } from "@admitto/ui";
import { useNavigate } from "react-router-dom";
import { ApiError, completeSetup } from "../../api/client.js";
import { useWizard } from "./WizardContext.js";

type WizardStep5ReadyProps = {
  onComplete: () => Promise<void>;
};

type SummaryChip = {
  key: string;
  icon: string;
  label: string;
};

export function WizardStep5Ready({ onComplete }: WizardStep5ReadyProps) {
  const { addToast } = useToast();
  const navigate = useNavigate();
  const { summary, selectedEventId, mailSkipped, brandingSkipped } = useWizard();
  const [submitting, setSubmitting] = useState(false);

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
      items.push({ key: "event", icon: "ti-calendar", label: summary.eventTitle });
    }

    return items;
  }, [brandingSkipped, mailSkipped, summary]);

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
            {chip.label}
          </span>
        ))}
      </div>

      <Button
        type="button"
        variant="primary"
        block
        disabled={submitting}
        iconRight={<i className="ti ti-arrow-right" />}
        onClick={() => void handleGoToDashboard()}
      >
        {submitting ? "Finishing…" : "Go to dashboard"}
      </Button>
    </div>
  );
}
