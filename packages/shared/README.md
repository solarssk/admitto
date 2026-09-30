# @admitto/shared

Small, framework-free helpers shared across workspace packages (no DB, no crypto). Keep app logic out of here. It has a few focused runtime dependencies (`@vvo/tzdb`, `tzdata`, `ip-location-api`, `undici`), used only by the Node-only subpaths below.

## Exports

`src/index.ts` is the source of truth for the root entry. The root entry is safe for the browser (`apps/admin` imports it), so Node-only modules are deliberately **not** re-exported from it and live behind subpaths.

| Entry | What it provides |
|-------|------------------|
| `@admitto/shared` (root) | `splitCsvLine` (one CSV line with quoted fields and doubled quotes; single line only, no multi-line quoted fields; used by `@admitto/import` and `@admitto/mailer`), `redactEmail`, contact email / phone limits and validators, `parseUserAgent*`, `NO_COMPRESSION_HEADERS`, supported locales and time formats, event-end helpers (`eventEndsAtUtc`, `eventEndsAtLocal`, `isWalletAddClosed`), `zonedWallClockToUtcIso`, `MAIL_PROVIDER_LABELS`, health status types, and the report / delivery DTO types shared by the server and the SPA |
| `@admitto/shared/ssrf-guard` | Node-only SSRF guard for outbound URLs (`resolveSafeHostname`, `isBlockedPrivateOrMetadataHost`, `SafeHostnameError`, ...) |
| `@admitto/shared/pinned-dispatcher` | `createPinnedDispatcher(hostname, record)`: an `undici` agent pinned to an already validated address |
| `@admitto/shared/ip-location` | `resolveIpLocation(ip)`: offline IP to country / city lookup (`ip-location-api` dataset) |
| `@admitto/shared/system-log` | The in-memory system log tail (`recordSystemLog`, `querySystemLogs`) |
| `@admitto/shared/load-env-file` | `loadEnvFile(path)`: a small `.env` loader |
| `@admitto/shared/sse-events` | Server-sent event types and per-event channel names (`sseChannelName`, `SseEvent`) |
| `@admitto/shared/timezones` | Time zone definitions and helpers (`getTimeZones`, `normalizeTimeZone`, `getTimeZoneAbbreviationForDate`) |
| `@admitto/shared/region-date-format` | Region-aware date and event-hours formatting (`formatDate`, `formatEventHour`, `formatEventHoursRangeText`) used by emails, tickets and wallet passes |

## Import

```ts
import { splitCsvLine, eventEndsAtUtc } from "@admitto/shared";
import { resolveSafeHostname } from "@admitto/shared/ssrf-guard"; // Node only
```

## Build

```bash
npm run build -w @admitto/shared
```

Other packages depend on the compiled `dist/` output via workspace `prepare` hooks.
