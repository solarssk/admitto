# Glossary

**Audience:** All staff · **Required role:** Any staff role · **Feature status:** ✅ Available · **Last verified:** Admitto 0.6.0

The terms are grouped by topic.

## Instance, organisation and event

| Term | Meaning |
|---|---|
| Instance | One deployed Admitto system and its instance-wide settings. |
| Organisation | The scope that owns events and Organisation Admin assignments. |
| Event | A dated attendee, communication, and check-in workspace owned by an organisation. |
| Archived event | A read-only completed event. Check-in and event mutations are disabled. |
| External service | A third-party API that Admitto's server calls on the customer's behalf when a feature is enabled, for example address lookup, map tiles or weather. These services never receive attendee personal data. See [Organisation Settings](Organisation-Settings) → External services. |

## Staff roles

| Term | Meaning |
|---|---|
| Organisation Admin | A staff user who manages events for an assigned organisation. The stored role name is Admin. |
| Operator | A staff user assigned to check-in for a specific event. |
| Superadmin | A staff user who manages instance-wide accounts, settings, identity, mail, and logs. |
| RBAC (role-based access control) | Admitto's own permission model. Access is granted by role (Superadmin, Organisation Admin, Operator) and by scope (instance, organisation or event). It works the same whether sign-in uses a local password, SSO or a ZTNA gateway. |

## Attendees and tickets

| Term | Meaning |
|---|---|
| Attendee | A person invited to one event. |
| Ticket type | A configured event category stored on an attendee. |
| Custom attendee field | Extra event-specific attendee information defined in **Requirements**. |
| Pass | The attendee's right to use an event ticket. It can be active, revoked, or cancelled. |
| Ticket | The link and QR information sent to an attendee. |
| Wallet pass | An Apple or Google Wallet version of an attendee's ticket, created through PassCreator when Wallet is turned on for the event. It mirrors the pass status automatically: revoking or restoring the attendee's pass does the same to the wallet pass. See [Wallet Passes Overview](Wallet-Passes-Overview). |
| Attendance confirmation | The attendee's response before the event. It is shown as **Attendance** on attendee forms and as **Attendance confirmation** in reports. It does not prove that the person attended. |

## Sending

| Term | Meaning |
|---|---|
| Initial send | The first claimed ticket delivery for an attendee and event. |
| Resend | A later explicit delivery or a custom-template bulk delivery. |

## Check-in

| Term | Meaning |
|---|---|
| Check-in | Recording that an attendee was admitted to the event. |
| Check-in status | The operational result of an admission attempt, such as valid, already checked in, revoked, or invalid. It records what happened at the entrance. |
| Attendance (reports) | The recorded number of attendees admitted through check-in. This is different from the attendee's pre-event attendance confirmation. |
| Event item | A physical or tracked requirement, such as a badge or material, handled during check-in. |

## Sign-in and security

| Term | Meaning |
|---|---|
| SSO (single sign-on) | Staff sign in with an existing corporate account instead of a separate Admitto password. Admitto supports this through OIDC. |
| OIDC | The sign-in protocol Admitto uses to connect to a corporate identity provider for SSO, for example Microsoft Entra ID, Okta, or Authentik. Configured under Organisation settings → Identity. |
| Identity provider (IdP) | The corporate system (Entra ID, Okta, Authentik, or similar) that verifies a staff member's identity for SSO and reports their group membership. Admitto maps the groups to roles. |
| MFA / TOTP | Multi-factor authentication: a time-based one-time code from an authenticator app. It is required at sign-in for roles whose policy demands it, in addition to a password or SSO. |
| Passkey | A second factor that you register under My account, for example Face ID, Windows Hello, or a passkey saved in a password manager or iCloud Keychain and synced across your devices. You can use it to sign in and to confirm sensitive account actions, the same way as an authenticator app code. |
| Security key | A physical FIDO2/WebAuthn device (for example a YubiKey), registered and used the same way as a passkey. |
| ZTNA (Zero Trust Network Access) | A gateway placed in front of staff URLs. It checks identity and device before a request ever reaches Admitto. It is a network-layer control, separate from and in addition to Admitto's own role-based access. Admitto has native support for **Cloudflare Access**, configured under Organisation settings → Identity. |

See [Roles and Permissions](Roles-and-Permissions) for the permission matrix and [Reference](Reference-and-Troubleshooting) for status references.
