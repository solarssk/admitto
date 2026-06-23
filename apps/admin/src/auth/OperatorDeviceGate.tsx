import { useState } from "react";
import { Outlet } from "react-router-dom";
import { useAuth } from "./AuthProvider.js";
import { DeviceLabelStep } from "../pages/DeviceLabelStep.js";

const SKIP_KEY = "admitto_skip_device_label";

/** Prompt for optional device label after sign-in, before operator check-in surfaces. */
export function OperatorDeviceGate() {
  const { deviceLabel, loading, refresh } = useAuth();
  const [skipped, setSkipped] = useState(() => sessionStorage.getItem(SKIP_KEY) === "1");

  if (loading) {
    return <p>Loading…</p>;
  }

  if (!deviceLabel && !skipped) {
    return (
      <DeviceLabelStep
        onSaved={async () => {
          sessionStorage.removeItem(SKIP_KEY);
          await refresh();
        }}
        onSkip={() => {
          sessionStorage.setItem(SKIP_KEY, "1");
          setSkipped(true);
        }}
      />
    );
  }

  return <Outlet />;
}
