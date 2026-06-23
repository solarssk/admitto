-- Optional /login SSO button copy per OIDC provider (default resolved in app when NULL).
ALTER TABLE "IdentityProvider" ADD COLUMN "login_button_label" TEXT;
