import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { Input, useToast } from "@admitto/ui";
import { LogoUploadZone } from "../../components/LogoUploadZone.js";
import { fetchOrgBranding, patchOrgBranding } from "../../api/client.js";
import { operatorApiErrorMessage } from "../../api/operator-api-error.js";
import { useDelayedLoading } from "../../hooks/useDelayedLoading.js";
import { safeBrandingLogoHref } from "../../utils/safeBrandingLogoHref.js";
import { useWizard } from "./WizardContext.js";

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
    const [loading, setLoading] = useState(true);
    const loadAbortRef = useRef<AbortController | null>(null);

    useEffect(() => {
      loadAbortRef.current?.abort();
      const ac = new AbortController();
      loadAbortRef.current = ac;
      setLoading(true);
      void (async () => {
        try {
          const data = await fetchOrgBranding(ac.signal);
          if (ac.signal.aborted) return;
          setOrgName(data.org_name ?? "");
          setLogoUrl(data.logo_url ?? "");
        } catch (err) {
          if (ac.signal.aborted) return;
          addToast(
            operatorApiErrorMessage(err, "Failed to load branding."),
            "error",
          );
        } finally {
          if (!ac.signal.aborted) setLoading(false);
        }
      })();
      return () => ac.abort();
    }, [addToast]);

    const saveBranding = async (): Promise<boolean> => {
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
        });
        setOrgName(data.org_name ?? name);
        setLogoUrl(data.logo_url ?? "");
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

    // A fetch that resolves near-instantly (localhost, a warm cache) would otherwise flash
    // the "Loading…" text on and off faster than it can register as loading — show it only
    // once the fetch has genuinely taken a moment.
    const showLoading = useDelayedLoading(loading);

    return (
      <>
        <p className="setup-wizard__step-sub">
          Set your organisation name and logo for ticket pages and emails.
        </p>

        {loading && showLoading && <p>Loading branding…</p>}

        {!loading && (
          <>
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
                onChange={(url) => {
                  setLogoUrl(url);
                  onDirtyChange?.(true);
                }}
                onDirty={() => onDirtyChange?.(true)}
              />
            </div>
          </>
        )}
      </>
    );
  },
);
