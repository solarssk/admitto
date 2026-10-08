import {
  forwardRef,
  useImperativeHandle,
  useState,
} from "react";
import { Input, Skeleton, useToast } from "@admitto/ui";
import { LogoUploadZone } from "../../components/LogoUploadZone.js";
import { fetchOrgBranding, patchOrgBranding } from "../../api/client.js";
import { operatorApiErrorMessage } from "../../api/operator-api-error.js";
import { panelView, usePanelLoad } from "../../hooks/usePanelLoad.js";
import { safeBrandingLogoHref } from "../../utils/safeBrandingLogoHref.js";
import type { LogoCropMeta } from "../../api/types.js";
import { useWizard } from "./WizardContext.js";
import { WizardRetryNotice, WizardStepPlaceholder } from "./WizardStepLoad.js";

export type WizardStep3BrandingHandle = {
  saveAndContinue: () => Promise<boolean>;
};

type WizardStep3BrandingProps = {
  onDirtyChange?: (dirty: boolean) => void;
};

export const WizardStep3Branding = forwardRef<WizardStep3BrandingHandle, WizardStep3BrandingProps>(
  function WizardStep3Branding({ onDirtyChange }, ref) {
    const { addToast } = useToast();
    const { setBrandingSkipped, setSummary } = useWizard();
    const [orgName, setOrgName] = useState("");
    const [logoUrl, setLogoUrl] = useState("");
    const [logoOriginalUrl, setLogoOriginalUrl] = useState("");
    const [logoCrop, setLogoCrop] = useState<LogoCropMeta | null>(null);
    const [committedLogoUrl, setCommittedLogoUrl] = useState<string | null>(null);
    const [committedLogoOriginalUrl, setCommittedLogoOriginalUrl] = useState<string | null>(null);

    // The first read of the step: a placeholder of the form's shape after 200ms, and an error with a busy Retry after 30
    // seconds or when it fails, never a form that looks empty because the read did not work (a save would then overwrite
    // what is stored), and the form once the answer is in.
    const panel = usePanelLoad({
      fetch: fetchOrgBranding,
      apply: (data) => {
        setOrgName(data.org_name ?? "");
        setLogoUrl(data.logo_url ?? "");
        setLogoOriginalUrl(data.logo_original_url ?? "");
        setLogoCrop(data.logo_crop ?? null);
        setCommittedLogoUrl(data.logo_url ?? null);
        setCommittedLogoOriginalUrl(data.logo_original_url ?? null);
      },
      fallback: "Could not load branding.",
    });
    const view = panelView(panel);

    const saveBranding = async (): Promise<boolean> => {
      // Nothing to save before the read has answered: the form is not there.
      if (view !== "ready") return false;
      const name = orgName.trim();
      const logo = logoUrl.trim();

      if (!name) {
        addToast("Organisation name is required.", "error");
        return false;
      }
      if (logo && !safeBrandingLogoHref(logo)) {
        addToast("Logo must be a valid HTTPS URL or uploaded image.", "error");
        return false;
      }

      try {
        const data = await patchOrgBranding({
          org_name: name,
          logo_url: logo || null,
          logo_original_url: logoOriginalUrl.trim() || null,
          logo_crop: logoCrop,
        });
        setOrgName(data.org_name ?? name);
        setLogoUrl(data.logo_url ?? "");
        setLogoOriginalUrl(data.logo_original_url ?? "");
        setLogoCrop(data.logo_crop ?? null);
        setCommittedLogoUrl(data.logo_url ?? null);
        setCommittedLogoOriginalUrl(data.logo_original_url ?? null);
        onDirtyChange?.(false);
        setBrandingSkipped(false);
        setSummary({ brandingLabel: name });
        return true;
      } catch (err) {
        addToast(operatorApiErrorMessage(err, "Failed to save branding."), "error");
        return false;
      }
    };

    useImperativeHandle(ref, () => ({
      saveAndContinue: saveBranding,
    }));

    return (
      <>
        <p className="setup-wizard__step-sub">
          Set your organisation name and logo for ticket pages and emails.
        </p>

        {view === "loading" && (
          <WizardStepPlaceholder label="Loading branding" held={!panel.gate.showIndicator} slow={panel.slow}>
            <BrandingStepSkeleton />
          </WizardStepPlaceholder>
        )}

        {view === "error" && panel.error && (
          <WizardRetryNotice retrying={panel.retrying} onRetry={panel.retry}>
            <strong>Could not load branding</strong>
            <br />
            {panel.error}
          </WizardRetryNotice>
        )}

        {view === "ready" && (
          <div className="at-fade-in">
            <div className="setup-wizard__field">
              <Input
                label="Organisation name"
                value={orgName}
                placeholder="e.g. Acme Corp"
                onChange={(e) => {
                  setOrgName(e.target.value);
                  onDirtyChange?.(true);
                }}
              />
              <p className="setup-wizard__hint">
                Used as fallback when no logo is set. Shown in the ticket header.
              </p>
            </div>

            <div className="setup-wizard__field">
              <LogoUploadZone
                value={logoUrl}
                originalUrl={logoOriginalUrl || null}
                cropMeta={logoCrop}
                committedValue={committedLogoUrl}
                committedOriginalUrl={committedLogoOriginalUrl}
                onChange={(url) => {
                  setLogoUrl(url);
                  onDirtyChange?.(true);
                }}
                onSourceChange={(source) => {
                  setLogoOriginalUrl(source.originalUrl ?? "");
                  setLogoCrop(source.crop);
                  onDirtyChange?.(true);
                }}
                onDirty={() => onDirtyChange?.(true)}
              />
            </div>
          </div>
        )}
      </>
    );
  },
);

/**
 * The shape of the form, as tall as the one that replaces it (measured in Chrome at the wizard's own width: 320px against
 * 327px): the organisation name's label, field and hint, and the logo's label, two lines of intro, drop zone and the link
 * under it.
 */
function BrandingStepSkeleton() {
  return (
    <>
      <div className="setup-wizard__field">
        <div className="at-field">
          <Skeleton variant="rect" width={128} height={17} />
          <Skeleton variant="rect" height={38} />
        </div>
        <Skeleton variant="rect" width="70%" height={18} />
      </div>
      <div className="setup-wizard__field">
        <div className="setup-wizard__placeholder-logo">
          <Skeleton variant="rect" width={120} height={17} />
          <div className="at-field">
            <Skeleton variant="rect" height={16} />
            <Skeleton variant="rect" width="62%" height={16} />
          </div>
          <Skeleton variant="rect" height={120} />
          <Skeleton variant="rect" width={168} height={28} />
        </div>
      </div>
    </>
  );
}
