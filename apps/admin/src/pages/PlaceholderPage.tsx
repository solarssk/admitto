import { Card, PageHeader } from "@admitto/ui";

export interface PlaceholderPageProps {
  title: string;
  subtitle?: string;
}

export function PlaceholderPage({ title, subtitle }: PlaceholderPageProps) {
  return (
    <Card>
      <PageHeader title={title} subtitle={subtitle ?? "Coming soon in a future release."} />
      <p className="placeholder-note">This lifecycle stage is part of the v0.4 shell — functionality arrives in later PRs.</p>
    </Card>
  );
}
