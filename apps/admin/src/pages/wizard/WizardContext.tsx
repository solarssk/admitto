import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type WizardSummary = {
  mailLabel: string;
  brandingLabel: string;
  eventTitle: string | null;
};

export type WizardContextValue = {
  completedSteps: Set<number>;
  markStepComplete: (step: number) => void;
  selectedEventId: string | null;
  setSelectedEventId: (id: string | null) => void;
  mailSkipped: boolean;
  setMailSkipped: (skipped: boolean) => void;
  brandingSkipped: boolean;
  setBrandingSkipped: (skipped: boolean) => void;
  summary: WizardSummary;
  setSummary: (patch: Partial<WizardSummary>) => void;
};

const WizardContext = createContext<WizardContextValue | null>(null);

const DEFAULT_SUMMARY: WizardSummary = {
  mailLabel: "Skipped",
  brandingLabel: "Skipped",
  eventTitle: null,
};

export const WIZARD_CONTEXT_STORAGE_KEY = "admitto_wizard_context";

type PersistedWizardContext = {
  selectedEventId: string | null;
  mailSkipped: boolean;
  brandingSkipped: boolean;
  summary: WizardSummary;
};

function readPersistedWizardContext(): PersistedWizardContext | null {
  try {
    const raw = sessionStorage.getItem(WIZARD_CONTEXT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedWizardContext>;
    if (!parsed || typeof parsed !== "object") return null;
    return {
      selectedEventId: typeof parsed.selectedEventId === "string" ? parsed.selectedEventId : null,
      mailSkipped: Boolean(parsed.mailSkipped),
      brandingSkipped: Boolean(parsed.brandingSkipped),
      summary: { ...DEFAULT_SUMMARY, ...parsed.summary },
    };
  } catch {
    return null;
  }
}

export function WizardProvider({ children }: { children: ReactNode }) {
  const persisted = readPersistedWizardContext();
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(() => new Set());
  const [selectedEventId, setSelectedEventId] = useState<string | null>(
    () => persisted?.selectedEventId ?? null,
  );
  const [mailSkipped, setMailSkipped] = useState(() => persisted?.mailSkipped ?? false);
  const [brandingSkipped, setBrandingSkipped] = useState(() => persisted?.brandingSkipped ?? false);
  const [summary, setSummaryState] = useState<WizardSummary>(
    () => persisted?.summary ?? DEFAULT_SUMMARY,
  );

  const markStepComplete = useCallback((step: number) => {
    setCompletedSteps((prev) => {
      const next = new Set(prev);
      next.add(step);
      return next;
    });
  }, []);

  const setSummary = useCallback((patch: Partial<WizardSummary>) => {
    setSummaryState((prev) => ({ ...prev, ...patch }));
  }, []);

  useEffect(() => {
    const payload: PersistedWizardContext = {
      selectedEventId,
      mailSkipped,
      brandingSkipped,
      summary,
    };
    sessionStorage.setItem(WIZARD_CONTEXT_STORAGE_KEY, JSON.stringify(payload));
  }, [selectedEventId, mailSkipped, brandingSkipped, summary]);

  const value = useMemo(
    () => ({
      completedSteps,
      markStepComplete,
      selectedEventId,
      setSelectedEventId,
      mailSkipped,
      setMailSkipped,
      brandingSkipped,
      setBrandingSkipped,
      summary,
      setSummary,
    }),
    [
      completedSteps,
      markStepComplete,
      selectedEventId,
      mailSkipped,
      brandingSkipped,
      summary,
      setSummary,
    ],
  );

  return <WizardContext.Provider value={value}>{children}</WizardContext.Provider>;
}

export function useWizard(): WizardContextValue {
  const ctx = useContext(WizardContext);
  if (!ctx) throw new Error("useWizard requires WizardProvider");
  return ctx;
}
