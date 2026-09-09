#!/usr/bin/env node
/**
 * Regenerate the PNG email assets used by the system notification email (admitto-logo.png +
 * the 3 severity badges). The actual generation logic lives in
 * apps/web/src/notification-email-assets.ts, not here - see that file's own doc comment for why.
 * Requires apps/web to already be built (`npm run build -w @admitto/web`).
 *
 *   node scripts/generate-notification-email-assets.mjs
 */
import { generateNotificationEmailAssets } from "../apps/web/dist/src/notification-email-assets.js";

for (const path of await generateNotificationEmailAssets()) {
  console.log(`wrote ${path}`);
}
