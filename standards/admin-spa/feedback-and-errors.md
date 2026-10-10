# Admin SPA feedback and API errors

Read before showing any success, error, warning or confirmation in `apps/admin`. Wording of the messages: [docs/dev/error-and-notice-copy.md](../../docs/dev/error-and-notice-copy.md).

---

## Admin SPA feedback (toast vs inline)

Staff UI uses `useToast()` from `@admitto/ui` (`ToastProvider` in the admin shell). Pick the surface by how long the user needs the message and whether it blocks the current task.

| Pattern | When | Examples |
|--------|------|----------|
| **Toast** | Transient outcome of an action the user just took; does not need a retry control | Save/test success, mutation API errors, import finished, wizard step saved |
| **`Notice`** | Persistent fact or warning about the surrounding view (bordered/tinted box with icon) | Settings warnings, wizard banners, form-level auth errors. Server-rendered auth pages use the same `.at-notice` markup via `renderNoticeHtml` (not the React component) |
| **Inline / `EmptyState`** | Initial page load failed or data is missing until the user retries. A failed load is `<EmptyState variant="error">`, which is announced as an alert; an empty list stays a plain `EmptyState` (a status) | Attendees/Requirements load error with **Retry**; AuthProvider session bootstrap failure |
| **`ConfirmDialog`** | Destructive or irreversible confirmation | Delete attendee, archive event - do not also toast the same message |
| **In-context inline** | Error is tied to a modal, form field, or overlay that already has focus | Mobile check-in camera overlay (no-match → overlay message, not toast behind overlay); form field validation |

Toasts dedupe identical `message + variant`, cap at five, and sit below the check-in overlay (`--z-toast` &lt; `--z-overlay`). Prefer `renderWithToast()` in admin tests when asserting toast behavior.

**Never use the native `window.confirm()` / `window.alert()`** for a confirmation. Always use the app's
`ConfirmDialog` (`apps/admin/src/components/ConfirmDialog.tsx`).

`confirmVariant` defaults to `"primary"`. Reserve a higher severity only for actions that actually destroy something:

- **`"primary"` (default):** any other confirmation, including prompts about form state that only exists in-memory and nothing has actually been lost yet. "Discard unsaved changes?" is the canonical example: the wording sounds alarming, but the amber/red treatment used for a real delete would misrepresent the risk.
- **`"danger"` / `"warning"`:** genuinely irreversible actions (delete, permanently revoke, archive).

See `apps/admin/src/identity/DiscardUnsavedChangesDialogs.tsx` for the shared two-dialog pattern (one for the Cancel button, one for the router's dirty-guard blocker) that most editors with unsaved-changes protection should reuse rather than re-implementing per screen.

**Check-in camera exception:** the desktop inline camera (`CkInlineCamera`) is scan-only. It never doubles as the operator's check-in/item-issuing surface, so no result ever renders on top of it.

- **Desktop inline camera:** a no-match scan reports via **toast**, the same as manual lookup's no-match, and the camera keeps scanning.
- **Mobile fullscreen overlay:** still governed by the in-context-inline row above. A toast would render below `--z-overlay` and be invisible there, so no-match must render on the overlay itself.

### Admin API errors in the UI

Do **not** pass `ApiError.message` straight into toasts or inline error strings. Server JSON may include machine codes or, in future, internal detail.

- Use `operatorApiErrorMessage(err, fallback)` from `apps/admin/src/api/operator-api-error.ts` for operator-visible copy.
- Use `hasApiErrorCode(err, "code")` when branching on a known API failure (exact match on normalized `err.code` / machine-readable `err.message`).
- Known codes are mapped to fixed UI strings; short human `detail` text is shown only when it passes the helper's safety checks; everything else logs in dev and returns `fallback`.
- `TemplateValidationError` and client-side validation stay separate - they never go through `operatorApiErrorMessage`.

The table above governs which surface to use; it doesn't govern what the text inside it says. For
which register (Superadmin/Administrator/Operator/Public attendee) gets how much technical detail,
and the content rules behind it, see [docs/dev/error-and-notice-copy.md](../../docs/dev/error-and-notice-copy.md).
