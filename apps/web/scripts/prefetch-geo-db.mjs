// Bakes the offline IP->country dataset into the Docker image at build time (see
// apps/web/src/rate-limit/ip-location.ts and the ILA_* env vars set around this script's call
// site in the Dockerfile) so the running container never fetches it at startup or per-request.
import { lookup } from "ip-location-api";

const result = lookup("1.1.1.1");
if (!result?.country) {
  console.error("ip-location-api: pre-fetch failed - no country resolved for a known public IP.");
  process.exit(1);
}
console.log(`ip-location-api: database ready (sample lookup resolved to ${result.country}).`);
