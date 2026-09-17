// Moved to @admitto/shared/src/parseUserAgent.ts so packages/auth's server-side notification
// content (a new-location sign-in alert's "device" line) can reuse the same isomorphic parser
// instead of duplicating its regex tables - see that file's own doc comment. Re-exported here so
// this app's own call sites (AccountPage.tsx, AttendeeDetailPage.tsx, SessionListItem.tsx) keep
// importing from the same local path.
export { parseUserAgent, parseUserAgentWithVersion } from "@admitto/shared";
