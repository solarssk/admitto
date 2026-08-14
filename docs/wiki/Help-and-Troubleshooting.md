# Help and Troubleshooting

| | |
|---|---|
| **Audience** | All staff |
| **Required role** | Any staff role |
| **Feature status** | Available |
| **Last verified** | Admitto 0.5.1 |

Start with the page for the failed workflow:

| Problem | First page to use |
|---|---|
| Sign-in, MFA, or missing access | [Users and Roles Administration](Users-and-Roles-Administration) or [Identity and SSO](Identity-and-SSO) |
| Invalid, warning, or skipped import rows | [Importing Attendees](Importing-Attendees) and [Import File Reference](Import-File-Reference) |
| Template preview or test failure | [Email Templates](Email-Templates) and [Advanced Email Templates](Advanced-Email-Templates) |
| Failed, bounced, or rejected delivery | [Email Delivery Statuses](Email-Delivery-Statuses) |
| Wallet pass not created, not updating, or wallet badge link empty | [Wallet Passes Overview](Wallet-Passes-Overview) |
| Invalid or revoked check-in result | [Scanning Tickets and Check-in Results](Scanning-Tickets-and-Results) |
| No manual lookup result or wrong admission | [Manual Lookup and Corrections](Manual-Lookup-and-Corrections) |
| Offline or reconnecting check-in | [Check-in Connection Problems](Check-in-Connection-Problems) |
| Instance configuration or logs | [Organisation Settings](Organisation-Settings) and [Logs and Audit](Logs-and-Audit) |
| System health or support dump for a bug report | [Organisation Settings](Organisation-Settings) → Health check |

## Report a product problem

1. Record the Admitto version shown in the interface (sidebar footer).
2. Optional: open **Organisation settings → Health check**, use **Copy for GitHub Issue**, and paste the snapshot into the bug form. Remove any remaining secrets or personal data before posting.
3. Record the page, approximate time, expected result, and safe error text.
4. Remove attendee data, addresses, ticket links, QR values, secrets, and provider responses.
5. Use the repository's [bug report form](https://github.com/solarssk/admitto/issues/new?template=bug.yml).

For a suspected security problem, use the [security reporting policy](https://github.com/solarssk/admitto/blob/main/SECURITY.md) instead of a public issue.
