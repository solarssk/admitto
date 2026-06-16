import { Card, PageHeader } from "@admitto/ui";
import { useAuth } from "../auth/AuthProvider.js";
import { CheckInPage } from "./CheckInPage.js";

/** Admin check-in: live scanner only when an Admitto session exists (CF-only cannot call scan API). */
export function AdminCheckInRoute() {
  const { hasAdmittoSession } = useAuth();

  if (!hasAdmittoSession) {
    const next = encodeURIComponent(window.location.pathname + window.location.search);
    return (
      <Card>
        <PageHeader
          title="Check-in"
          subtitle="Live scanning requires an Admitto session in addition to Cloudflare Access."
        />
        <p>
          <a href={`/login?next=${next}`}>Sign in to Admitto</a> to scan guests from the admin panel,
          or use the <a href="/operator">operator check-in</a> surface on event day.
        </p>
      </Card>
    );
  }

  return <CheckInPage />;
}
