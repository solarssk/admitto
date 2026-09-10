/** Re-exported from @admitto/shared, where the implementation now lives so packages/auth can use
 * it too without depending on apps/web - the wrong direction for a foundational package to depend
 * in. Kept as a re-export (not a straight import-and-use at call sites) so every existing caller
 * in this app keeps importing from this same, established path. */
export { resolveIpLocation, type IpLocation, type IpLocationKind } from "@admitto/shared/ip-location";
