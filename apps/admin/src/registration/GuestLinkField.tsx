import { Input, useToast } from "@admitto/ui";

/**
 * The address guests open the form at, with a button that copies it. It is the same address whatever the way in is (a password is
 * asked for on the form). While the instance has no address there is no link to give, and a sentence says who sets it.
 */
export function GuestLinkField({ url, registrationOn }: Readonly<{ url: string | null; registrationOn: boolean }>) {
  const { addToast } = useToast();
  if (url === null) {
    return <p className="settings-card-intro">There is no link yet, because the address of this instance is not set. Ask a superadmin to set it up.</p>;
  }

  async function copy(link: string) {
    try {
      await navigator.clipboard.writeText(link);
      addToast("Link copied.", "success");
    } catch {
      addToast("Could not copy the link.", "error");
    }
  }

  return (
    <Input
      label="Link for guests"
      value={url}
      readOnly
      icon={<i className="ti ti-copy" />}
      iconLabel="Copy the link for guests"
      onIconClick={() => void copy(url)}
      hint={registrationOn ? "Guests open the form at this link." : "This link works once registration is on."}
    />
  );
}
