import { Card, PageHeader } from "@admitto/ui";

export interface PlaceholderPageProps {
  title: string;
  subtitle?: string;
}

export function PlaceholderPage({ title, subtitle }: PlaceholderPageProps) {
  return (
    <Card>
      <PageHeader title={title} subtitle={subtitle ?? "Not available yet."} />
      <p className="placeholder-note">This section isn’t available in this version of Admitto yet.</p>
    </Card>
  );
}
