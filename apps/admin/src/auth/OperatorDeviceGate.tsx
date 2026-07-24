import { useState } from "react";
import { Outlet } from "react-router";
import { useAuth } from "./AuthProvider.js";
import { DeviceLabelStep } from "../pages/DeviceLabelStep.js";

function skipKey(userId: string): string {
  return `admitto_skip_device_label_${userId}`;
}

/** Prompt for optional device label after sign-in, before operator check-in surfaces. */
export function OperatorDeviceGate() {
  const { user, deviceLabel, loading, refresh } = useAuth();
  const [skipped, setSkipped] = useState(() => sessionStorage.getItem(skipKey(user.id)) === "1");

  if (loading) {
    return <p>Loading…</p>;
  }

  if (!deviceLabel && !skipped) {
    return (
      <DeviceLabelStep
        onSaved={async () => {
          sessionStorage.removeItem(skipKey(user.id));
          await refresh();
        }}
        onSkip={() => {
          sessionStorage.setItem(skipKey(user.id), "1");
          setSkipped(true);
        }}
      />
    );
  }

  return <Outlet />;
}
