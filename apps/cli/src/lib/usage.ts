/** Emergency CLI help text (stdout). */
export function printUsage(): void {
  console.log(`Admitto emergency ops CLI: for use when the admin UI is unreachable during an event.

Usage: admitto <namespace> <command> [options]

Namespaces:
  worker       Background loop (bounce ingest + retention; ADR 0042) — long-running
  checkin      Manual attendee admission when the SPA/scanner is down
  attendees    Emergency CSV export (paper backup list)
  mail         Retry failed email deliveries
  auth         Superadmin bootstrap / MFA break-glass (bootstrap-superadmin, reset-mfa, generate-emergency-recovery)
  sessions     Emergency session purge (revoke --user, purge --all)
  retention    Manual retention run (auth sessions + mail snapshot cleanup)
  storage      Branding upload orphan GC (storage gc)

Options:
  --format     Command output: table (default) or json (checkin, sessions purge)
  --dry-run    Preview changes without writing
  --yes, -y    Skip interactive confirmations
  --operator-email  Required for destructive ops; attributes actions in AdminAuditLog

Examples:
  admitto worker
  admitto checkin lookup --event evt_123 --query "jan kowal"
  admitto checkin admit --event evt_123 --attendee-id att_456
  admitto checkin admit --event evt_123 --scan "https://tickets.example.com/t/..."
  admitto attendees export --event evt_123 --out /app/emergency-exports/emergency-attendees-evt_123.csv --operator-email super@example.com
  admitto mail retry-failed --event evt_123
  admitto auth bootstrap-superadmin --email admin@example.com
  admitto auth reset-mfa --email admin@example.com
  admitto sessions revoke --user admin@example.com --operator-email super@example.com
  admitto sessions purge --all --yes --operator-email super@example.com
  admitto retention run --operator-email super@example.com [--dry-run]
  admitto storage gc --operator-email super@example.com [--dry-run]`);
}
