// Fetches (or verifies) the offline IP->city dataset that apps/web/src/rate-limit/ip-location.ts
// reads at request time - never fetching it itself. Run at image build time by the Dockerfile
// (bakes the default node-geolite2-redist dataset in, no MaxMind account needed), and again at
// container startup by deploy/docker-entrypoint.sh's "serve" branch when MAXMIND_LICENSE_KEY is
// set (fetches a fresh copy directly from MaxMind into a separate, persistent location). Which
// ILA_* env vars are in effect - and so which dataset/location this run targets - is entirely the
// caller's responsibility; this script itself is a thin, reusable wrapper around ip-location-api's
// own build-or-verify behavior.
import { lookup } from "ip-location-api";

// 8.8.8.8 (Google Public DNS), not 1.1.1.1 - MaxMind's GeoLite2 database (see the ILA_LICENSE_KEY/
// ILA_FIELDS env vars around this script's call site in the Dockerfile) has no entry for some
// anycast addresses including 1.1.1.1/1.0.0.1/9.9.9.9, confirmed empirically against the actual
// downloaded database; 8.8.8.8 resolves reliably.
const result = lookup("8.8.8.8"); // NOSONAR - a well-known public IP used only as a local lookup key to sanity-check the just-fetched dataset; no network call is made to it
if (!result?.country) {
  console.error("ip-location-api: pre-fetch failed - no country resolved for a known public IP.");
  process.exit(1);
}
console.log(`ip-location-api: database ready (sample lookup resolved to ${result.country}).`);
