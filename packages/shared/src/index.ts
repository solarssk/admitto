export { splitCsvLine } from "./csvUtils.js";
export { redactEmail } from "./redact.js";
export type { DeliveryDetailDto, DeliveryDto } from "./deliveryDto.js";
export type { HealthOverallStatus, HealthRowStatus } from "./healthStatus.js";
export {
  SUPPORTED_LOCALE_TAGS,
  isSupportedLocale,
  sanitizePreferredLocale,
  type SupportedLocale,
} from "./supportedLocales.js";
export {
  PREFERRED_TIME_FORMATS,
  isPreferredTimeFormat,
  sanitizePreferredTimeFormat,
  type PreferredTimeFormat,
} from "./preferredTimeFormat.js";

// Node-only SSRF guard (imports node:net/node:dns) deliberately NOT re-exported here —
// this barrel is also consumed by the browser (apps/admin), and even an unused re-export
// pulls the module's top-level `new BlockList()` side effect into the browser bundle,
// where node:net is externalized to an empty shim and crashes on load. Import it from
// "@admitto/shared/ssrf-guard" instead (server-only code: @admitto/auth, @admitto/mailer).
