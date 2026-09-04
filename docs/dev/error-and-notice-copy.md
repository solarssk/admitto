# Error and notice message content

Admitto has two layers of rules for user-facing error/notice/status messages. [AGENTS.md](../../AGENTS.md#admin-spa-feedback-toast-vs-inline)
decides **which surface** to use (Toast, `Notice`, `EmptyState`+Retry, `ConfirmDialog`, in-context
inline) and how to get a server error into it safely (`operatorApiErrorMessage`, `hasApiErrorCode`).
This doc decides **what the text says**, specifically that the same underlying event should not get
the same words on every screen, because the reader's technical literacy differs by role. Today it
does get the same words everywhere: `CODE_MESSAGES` (`apps/admin/src/api/operator-api-error.ts`)
writes one flat register for every screen it's used on, including superadmin-only technical panels.
This doc is what closes that gap.

## Reader by role

Message copy is written for a specific reader. For most of the app, that reader is determined by
**where the component lives**: a route sits behind exactly one role's guard, and the guard picks
the register. A route that isn't behind a role-specific guard has no single reader, so it can't be
classified this way. Look for it explicitly (`docs/wiki/Roles-and-Permissions.md` lists which
guard, if any, sits in front of a given screen) rather than assuming location always resolves to
one row below - the "Shared staff surface" row exists precisely for the routes it doesn't.

| Register | Route / guard | Reader | Can name technical detail? |
|---|---|---|---|
| **Superadmin** | `/admin/settings` under `SuperadminGuard` (`apps/admin/src/App.tsx:186`); also `SUPERADMIN_ONLY_TABS` (`apps/admin/src/settings/eventSettingsTabs.ts:24-25`, the `mail`/`wallet`/`integrations` tabs inside per-event settings) | IT/infra person configuring the instance: Identity/OIDC, Cloudflare Access, Mail transport, System Logs, Archiving | Yes. System/provider name, HTTP status, machine error code, alongside a plain sentence |
| **Administrator** | `/admin` under `AdminGuard` (`apps/admin/src/App.tsx:181`), minus the superadmin-only settings tabs above | Org-level event manager running day-to-day ops: Attendees, Communication, Check-in admin, Requirements, Reports | No. Zero codes, zero jargon |
| **Operator** | `/operator` under `OperatorGuard` (`apps/admin/src/App.tsx:221`) | Check-in desk, reading under time pressure at the door | No, and terser than Administrator: one line, one action |
| **Shared staff surface** | `/account` under `AuthenticatedGuard` (`apps/admin/src/App.tsx:229`, `apps/admin/src/auth/RoleRouter.tsx:35-37` - a no-op guard, not a role check) | Whoever is signed in: Superadmin, Administrator, or Operator, viewing their own password/passkeys/sessions | No. Treat every reader as the least technical one who can land here (an Operator can reach `/account` too) - same floor as Administrator, regardless of the account's actual role |
| **Public attendee** | `apps/web` (`ticket-page.ts`, served at `/t/:token`) | General public, no product context, may be their only interaction with Admitto | No. Plainest and most reassuring of all four |

`docs/wiki/Roles-and-Permissions.md` is the canonical name source for the first three. Call the
org-admin persona **Administrator** in code and comments, not "event manager", since that's the
plain-English description of the role, not the product's name for it.

## Content rules

1. **One message per known cause, never one generic message for several causes.** *(Microsoft
   Writing Style Guide, [Error Message Guidelines](https://learn.microsoft.com/en-us/windows/win32/debug/error-message-guidelines))*
   If a 400 response can mean two different things, write two messages, not one that covers both.
   [`AddAttendeeModal.tsx:174-190`](../../apps/admin/src/attendees/AddAttendeeModal.tsx) is the
   pattern this rule asks for: the server's `customDataErrorPayload` branches on three distinct
   codes (`unknown_custom_data_field`, `required_custom_data_field_missing`, `validation_failed`)
   and carries the offending field's slug back to the client, which
   [`customDataApiErrorMessage`](../../apps/admin/src/attendees/customData.ts) turns into a
   specific per-field sentence (e.g. "Shirt size is required.") instead of one generic blob.
2. **Name the specific field or item in text, not color alone.** *(WCAG 2.x SC 3.3.1 Error
   Identification)* A validation error must say which field failed. The field slug is computed in
   [`packages/tickets/src/validate-custom-data.ts:48,74`](../../packages/tickets/src/validate-custom-data.ts),
   carried through the response by
   [`customDataErrorPayload`](../../apps/web/src/admin/attendees-api-routes.ts), and turned into
   the field's human label by `customDataApiErrorMessage` (see rule 1) - the slug now survives the
   full round trip, so the copy layer can always name the field.
3. **Say what happened and suggest the fix, not just that something is wrong.** *(WCAG SC 3.3.3
   Error Suggestion; NN/g [Error-Message Guidelines](https://www.nngroup.com/articles/error-message-guidelines/))*
   "Enter a value" is not a fix suggestion; "Attendee count must be a whole number, e.g. 12" is.
4. **Plain language, non-blaming tone, for every register except Superadmin.** *(NN/g)* Never
   "invalid"/"illegal" framed as the reader's fault. This matches the product's existing voice rule
   ("copy states what happened and what to do next, no marketing, no hype"). This doc adds the piece
   that voice rule doesn't cover: which register gets which level of technical detail.
5. **Superadmin register may show technical detail, but still needs structure.** "OIDC discovery
   failed" alone is not enough even for a technical reader. Pair the plain sentence with the detail:
   "Identity provider sign-in failed. The discovery endpoint returned 404 (`discovery_failed`)."
   Never a bare code with no sentence around it.
6. **Don't invent a message the API can't back up.** If the backend genuinely has no more detail
   than "something failed", say that plainly rather than fabricating a specific-sounding cause. A
   wrong specific message is worse than an honest generic one.
7. **The same event gets the same wording everywhere it appears, including within one component.**
   An `EmptyState`'s `title` and `description` describe the same failure - a box titled "Could not
   load audit log" whose text underneath says "Failed to load audit log" reads as two different
   problems to the reader, not one, even though only the verb differs. This also applies across
   screens: the fixed phrase for an initial-load failure is **"Could not load X"**, ending with a
   period as a complete sentence - not "Failed to load X" and not "X failed to load" - pick one verb
   for this class of message and use it everywhere, the same way `GENERIC_SEND_FAILED_MESSAGE`
   (`packages/mail-delivery/src/sanitizeError.ts`) is a single shared constant specifically so two call
   sites can't drift apart on the same fallback text. When adding a new load-error `EmptyState`, write
   the `title` and the `description`/fallback string together and read them back side by side before
   committing - CI cannot check this consistency the way `CODE_MESSAGES` coverage is checked
   ([AGENTS.md § Compounding rules](../../AGENTS.md#compounding-rules)), so it depends on the author
   actually re-reading both strings.

## What this doesn't cover

- Layout/surface choice (Toast vs `Notice` vs …): [AGENTS.md § Admin SPA feedback](../../AGENTS.md#admin-spa-feedback-toast-vs-inline).
- Getting server errors into the UI safely (never raw `ApiError.message`):
  [AGENTS.md § Admin API errors in the UI](../../AGENTS.md#admin-api-errors-in-the-ui),
  `operatorApiErrorMessage` / `hasApiErrorCode`.
- Mail template copy (attendee-facing email), governed by `packages/mail-templates`
  (rendering/placeholders/Outlook-safety). Apply this doc's Public-attendee register there too when
  writing new template copy, but the template pipeline itself isn't in scope here.
- General visual tone/voice (sentence case, no emoji, numbers-first), set elsewhere in the design
  system notes. This doc is additive to that, not a replacement.

## Sources

- Nielsen Norman Group, [Error-Message Guidelines](https://www.nngroup.com/articles/error-message-guidelines/)
- Microsoft, [Error Message Guidelines](https://learn.microsoft.com/en-us/windows/win32/debug/error-message-guidelines)
- W3C WAI, [Understanding SC 3.3.1: Error Identification](https://www.w3.org/WAI/WCAG21/Understanding/error-identification.html)
  and SC 3.3.3: Error Suggestion
