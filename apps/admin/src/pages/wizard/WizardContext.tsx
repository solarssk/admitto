import {
  createContext,
  useCallback,
  useContext,
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

export function WizardProvider({ children }: { children: ReactNode }) {
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(() => new Set());
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [mailSkipped, setMailSkipped] = useState(false);
  const [brandingSkipped, setBrandingSkipped] = useState(false);
  const [summary, setSummaryState] = useState<WizardSummary>(DEFAULT_SUMMARY);

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
