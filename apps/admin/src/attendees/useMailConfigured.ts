import { useEffect, useState } from "react";
import { fetchEventMailSettings } from "../api/client.js";

/**
 * Whether the event has a working mail transport at all - resolves the event's *effective*
 * transport (its own dedicated one, or the inherited org one; same resolution Event Settings ->
 * Mailing already shows). "export_only" is a real, saved provider value but never actually
 * delivers mail, so it doesn't count as configured here either - mirrors EventMailSettingsCard's
 * own transportConfigured check. Returns `undefined` while loading or on fetch failure (fails
 * open - callers should only disable a control on an explicit `=== false`, never on `undefined`).
 * Shared by the Attendees list's "Send tickets" button and the Attendee Detail page's "Resend
 * ticket" menu item, which both gate on the exact same check.
 */
export function useMailConfigured(eventId: string | undefined): boolean | undefined {
  const [mailConfigured, setMailConfigured] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    if (!eventId) return;
    setMailConfigured(undefined);
    const ac = new AbortController();
    fetchEventMailSettings(eventId, ac.signal)
      .then((data) => {
        if (ac.signal.aborted) return;
        const provider = data.fields.provider.value;
        setMailConfigured(provider === "smtp" || provider === "graph" || provider === "powerautomate");
      })
      .catch(() => {
        if (ac.signal.aborted) return;
        setMailConfigured(undefined);
      });
    return () => ac.abort();
  }, [eventId]);

  return mailConfigured;
}
