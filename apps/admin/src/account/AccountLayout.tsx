import { PageHeader } from "@admitto/ui";
import { AccountPage } from "./AccountPage.js";
import "./account-page.css";

export function AccountLayout() {
  return (
    <>
      <PageHeader
        title="My account"
        subtitle="Profile, password, two-factor authentication, and sessions."
      />
      <div className="settings-sections">
        <AccountPage />
      </div>
    </>
  );
}
