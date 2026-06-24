import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { Input, useToast } from "@admitto/ui";
import { ApiError, fetchOrgBranding, patchOrgBranding } from "../../api/client.js";
import { useWizard } from "./WizardContext.js";

export type WizardStep3BrandingHandle = {
  saveAndContinue: () => Promise<boolean>;
};

type WizardStep3BrandingProps = {
  onDirtyChange?: (dirty: boolean) => void;
};

/** Return a normalized HTTPS logo URL safe for img src, or null when invalid. */
function safeHttpsLogoHref(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) return null;
    return parsed.href;
  } catch {
    return null;
  }
}

export const WizardStep3Branding = forwardRef<WizardStep3BrandingHandle, WizardStep3BrandingProps>(
  function WizardStep3Branding({ onDirtyChange }, ref) {
    const { addToast } = useToast();
    const { setBrandingSkipped, setSummary } = useWizard();
    const [orgName, setOrgName] = useState("");
    const [logoUrl, setLogoUrl] = useState("");
    const [loading, setLoading] = useState(true);
    const [nameError, setNameError] = useState<string | null>(null);
    const [logoError, setLogoError] = useState<string | null>(null);
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
            err instanceof ApiError ? err.message : "Failed to load branding.",
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
      setNameError(null);
      setLogoError(null);

      if (!name) {
        setNameError("Organisation name is required.");
        return false;
      }
      if (logo && !safeHttpsLogoHref(logo)) {
        setLogoError("Logo URL must be a valid HTTPS URL without embedded credentials.");
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
        addToast(err instanceof ApiError ? err.message : "Failed to save branding.", "error");
        return false;
      }
    };

    useImperativeHandle(ref, () => ({
      saveAndContinue: saveBranding,
    }));

    const previewLogo = useMemo(() => safeHttpsLogoHref(logoUrl), [logoUrl]);

    return (
      <>
        <h2 className="setup-wizard__card-title">Branding</h2>
        <p className="setup-wizard__card-desc">
          Set your organisation name and logo for ticket pages and emails.
        </p>

        {loading && <p>Loading branding…</p>}

        {!loading && (
          <>
            <div className="setup-wizard__field">
              <Input
                label="Organisation name"
                value={orgName}
                placeholder="e.g. Acme Corp"
                onChange={(e) => {
                  setOrgName(e.target.value);
                  setNameError(null);
                  onDirtyChange?.(true);
                }}
              />
              <p className="setup-wizard__hint">
                Used as fallback when no logo is set. Shown in the ticket header.
              </p>
              {nameError && (
                <p className="setup-wizard__hint" style={{ color: "var(--status-error)" }} role="alert">
                  {nameError}
                </p>
              )}
            </div>

            <div className="setup-wizard__field">
              <Input
                label="Logo URL (HTTPS)"
                type="url"
                value={logoUrl}
                placeholder="https://cdn.example.com/logo.png"
                onChange={(e) => {
                  setLogoUrl(e.target.value);
                  setLogoError(null);
                  onDirtyChange?.(true);
                }}
              />
              <p className="setup-wizard__hint">
                Recommended: transparent PNG or WebP, max 160×48px. Shown on the ticket page.
              </p>
              {logoError && (
                <p className="setup-wizard__hint" style={{ color: "var(--status-error)" }} role="alert">
                  {logoError}
                </p>
              )}
            </div>

            <div className="setup-wizard__preview" aria-label="Ticket header preview">
              <div className="setup-wizard__preview-header">
                <div className="setup-wizard__preview-brand">
                  {previewLogo ? (
                    <img
                      src={previewLogo}
                      alt=""
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = "none";
                      }}
                    />
                  ) : (
                    <span>{orgName.trim() || "Your organisation"}</span>
                  )}
                </div>
                <span className="setup-wizard__preview-title">Event ticket</span>
              </div>
            </div>
          </>
        )}
      </>
    );
  },
);
