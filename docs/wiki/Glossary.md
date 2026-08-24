# Glossary

**Audience:** All staff · **Required role:** Any staff role · **Feature status:** ✅ Available · **Last verified:** Admitto 0.5.1

| Term | Meaning |
|---|---|
| Instance | One deployed Admitto system and its instance-wide settings. |
| Organisation | The scope that owns events and Organisation Admin assignments. |
| Event | A dated attendee, communication, and check-in workspace owned by an organisation. |
| Organisation Admin | A staff user who manages events for an assigned organisation. The stored role name is Admin. |
| Operator | A staff user assigned to check-in for a specific event. |
| Superadmin | A staff user who manages instance-wide accounts, settings, identity, mail, and logs. |
| Attendee | A person invited to one event. |
| Ticket type | A configured event category stored on an attendee. |
| Pass | The attendee's right to use an event ticket; it can be active, revoked, or cancelled. |
| Wallet pass | An Apple or Google Wallet version of an attendee's ticket, created through PassCreator when Wallet is turned on for the event. It mirrors the pass status automatically - revoking or restoring the attendee's pass does the same to the wallet pass. See [Wallet Passes Overview](Wallet-Passes-Overview). |
| Ticket | The link and QR information sent to an attendee. |
| Initial send | The first claimed ticket delivery for an attendee and event. |
| Resend | A later explicit delivery or a custom-template bulk delivery. |
| Attendance confirmation | The attendee's response before the event. It is shown as **Attendance** on attendee forms and as **Attendance confirmation** in reports; it does not prove that the person attended. |
| Attendance (reports) | The recorded number of attendees admitted through check-in. This is different from the attendee's pre-event attendance confirmation. |
| Check-in | Recording that an attendee was admitted to the event. |
| Check-in status | The operational result of an admission attempt, such as valid, already checked in, revoked, or invalid. It records what happened at the entrance. |
| Event item | A physical or tracked requirement, such as a badge or material, handled during check-in. |
| Custom attendee field | Extra event-specific attendee information defined in **Requirements**. |
| Archived event | A read-only completed event. Check-in and event mutations are disabled. |
| SSO (single sign-on) | Staff sign in with an existing corporate account instead of a separate Admitto password. Admitto supports this through OIDC. |
| OIDC | The sign-in protocol Admitto uses to connect to a corporate identity provider (for example Microsoft Entra ID, Okta, or Authentik) for SSO. Configured under Organisation settings → Identity. |
| Identity provider (IdP) | The corporate system (Entra ID, Okta, Authentik, or similar) that verifies a staff member's identity for SSO and reports their group membership, which Admitto maps to roles. |
| MFA / TOTP | Multi-factor authentication — a time-based one-time code from an authenticator app, required at sign-in for roles whose policy demands it, in addition to a password or SSO. |
| Passkey | A device-bound second factor (for example Face ID or Windows Hello) registered under My account, usable to sign in and to confirm sensitive account actions the same way an authenticator app code can. |
| Security key | A physical FIDO2/WebAuthn device (for example a YubiKey) registered and used the same way as a passkey. |
| ZTNA (Zero Trust Network Access) | A gateway placed in front of staff URLs that checks identity and device before a request ever reaches Admitto — a network-layer control, separate from and in addition to Admitto's own role-based access. Admitto has native support for **Cloudflare Access**, configured under Organisation settings → Identity. |
| RBAC (role-based access control) | Admitto's own permission model — access is granted by role (Superadmin, Organisation Admin, Operator) and scope (instance, organisation, or event), independent of whether sign-in happens via a local password, SSO, or a ZTNA gateway. |
| External service | A third-party API Admitto's server calls on the customer's behalf when a feature is enabled — for example address lookup, map tiles, or weather. See [Organisation Settings](Organisation-Settings) → External services. These never receive attendee personal data. |

See [Roles and Permissions](Roles-and-Permissions) for the permission matrix and [Reference](Reference-and-Troubleshooting) for status references.
