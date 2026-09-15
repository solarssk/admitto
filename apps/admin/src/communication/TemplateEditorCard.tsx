import {
  useMemo,
  useState,
  useEffect,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import CodeMirror, {
  EditorView,
  keymap,
  tooltips,
  type ReactCodeMirrorRef,
} from "@uiw/react-codemirror";
import { html } from "@codemirror/lang-html";
import { placeholderHighlightViewPlugin } from "./placeholderHighlightViewPlugin.js";
import { createUnknownPlaceholderLinter } from "./placeholderUnknownLint.js";
import { createPlaceholderAutocomplete, placeholderBracesConfig } from "./placeholderAutocomplete.js";
import { Button, Card, Input, Notice, Tooltip } from "@admitto/ui";
import type { EventDto } from "../api/types.js";
import { ARCHIVED_ACTION_TOOLTIP, ArchivedGuard, isEventArchived } from "../components/ArchivedGuard.js";
import { Segmented, type SegmentedOption } from "../components/Segmented.js";
import {
  HIDDEN_PLACEHOLDERS,
  WALLET_PLACEHOLDERS,
  placeholderDescription,
  svgDataUri,
  type ActiveField,
  type TemplateFormat,
} from "../pages/CommunicationPage.js";

/** Groups the insert-placeholder chips into readable sections instead of one long flat row -
 * a custom asset token (name not listed in any group) falls back to its own trailing "Images"
 * group, added dynamically below. */
const PLACEHOLDER_GROUPS: ReadonlyArray<{ label: string; names: readonly string[] }> = [
  { label: "Attendee", names: ["first_name", "last_name", "full_name", "email"] },
  {
    label: "Event",
    names: [
      "event_name",
      "event_date",
      "event_hours",
      "event_location",
      "event_address",
      "event_map_url",
      "google_maps_url",
      "apple_maps_url",
      "directions_text",
      "accessibility_text",
    ],
  },
  {
    label: "Ticket & QR",
    names: ["ticket_type", "ticket_url", "qr_image_url", "download_page_url"],
  },
  { label: "Wallet", names: ["apple_wallet_url", "google_wallet_url"] },
  { label: "Branding", names: ["logo_url"] },
];

const TEMPLATE_FORMAT_OPTIONS: ReadonlyArray<SegmentedOption<TemplateFormat>> = [
  { value: "mjml", label: "MJML" },
  { value: "html", label: "HTML" },
];

/** A real-looking (but not scannable) QR pattern: the three corner finder squares every QR code
 * has, plus a fixed, deterministic scatter of data modules elsewhere - recognizable as "this is
 * a QR code" at a glance, unlike a text-labeled box. */
function sampleQrDataUri(): string {
  const modules = 20;
  const m = 200 / modules;
  const finder = (mx: number, my: number) =>
    `<rect x="${mx * m}" y="${my * m}" width="${7 * m}" height="${7 * m}" fill="#1a1a1a"/>` +
    `<rect x="${(mx + 1) * m}" y="${(my + 1) * m}" width="${5 * m}" height="${5 * m}" fill="#fff"/>` +
    `<rect x="${(mx + 2) * m}" y="${(my + 2) * m}" width="${3 * m}" height="${3 * m}" fill="#1a1a1a"/>`;
  const inFinderZone = (x: number, y: number) =>
    (x < 8 && y < 8) || (x >= modules - 8 && y < 8) || (x < 8 && y >= modules - 8);
  let cells = "";
  for (let y = 0; y < modules; y++) {
    for (let x = 0; x < modules; x++) {
      if (inFinderZone(x, y)) continue;
      if ((x * 7 + y * 13 + x * y) % 3 === 0) {
        cells += `<rect x="${x * m}" y="${y * m}" width="${m}" height="${m}" fill="#1a1a1a"/>`;
      }
    }
  }
  return svgDataUri(
    '<rect width="200" height="200" fill="#fff"/>' +
      finder(0, 0) +
      finder(modules - 7, 0) +
      finder(0, modules - 7) +
      cells,
  );
}

/** Placeholder-chip hover preview for qr_image_url (see PlaceholderChips) - QR has no real
 * until-sent equivalent (it's generated per attendee), so this stays an illustrative sample
 * that looks like a QR code, for recognition in the picker. logo_url/header_image_url/
 * event_map_url use the real configured/resolved values instead (built in PlaceholderChips). */
const CHIP_QR_SAMPLE_DATA_URI = sampleQrDataUri();

/** One placeholder chip - required ones are outlined, wallet-add links get a ticket icon so
 * they read as "important" the same way an image chip does instead of blending into a bare-
 * token wall of text. A chip with a `sample` image (see PlaceholderChips - the real configured
 * logo/header, the real per-event map, or an illustrative QR graphic) shows that image instead
 * of a text tooltip - a picture of what the placeholder looks like is more useful than a
 * description once there are several image placeholders to tell apart, and required-ness still
 * reads from the chip's own outline styling either way. It's always visible as a small
 * thumbnail (not hover-only - a hidden-until-hover preview is easy to miss entirely), plus a
 * larger version on hover/focus for anyone who wants a closer look. A sample that fails to load
 * (event_map_url 404s when the event has no location set) falls back to the plain icon+tooltip
 * presentation, same as a chip with no sample at all. Chips without a (working) sample - plain
 * text/link placeholders, and per-event custom image tokens with no fixed sample - keep the
 * app's own Tooltip (@admitto/ui), not a native browser title tooltip. */
function PlaceholderChip({
  name,
  isImage,
  isRequired,
  onInsert,
  sample,
}: Readonly<{
  name: string;
  isImage: boolean;
  isRequired: boolean;
  onInsert: (name: string) => void;
  sample?: string;
}>) {
  const [sampleFailed, setSampleFailed] = useState(false);
  useEffect(() => {
    setSampleFailed(false);
  }, [sample]);
  const showSample = !!sample && !sampleFailed;
  const titleParts = [
    isRequired && "Required placeholder",
    placeholderDescription(name, isImage),
  ].filter((part): part is string => Boolean(part));
  const chip = (
    <button
      type="button"
      className={["communication-chip", isRequired && "communication-chip--required"]
        .filter(Boolean)
        .join(" ")}
      onClick={() => onInsert(name)}
    >
      {showSample ? (
        <img
          className="communication-chip-thumb"
          src={sample}
          alt=""
          width={16}
          height={16}
          onError={() => setSampleFailed(true)}
        />
      ) : (
        isImage && <i className="ti ti-photo" aria-hidden="true" />
      )}
      {WALLET_PLACEHOLDERS.has(name) && <i className="ti ti-ticket" aria-hidden="true" />}
      {`{{${name}}}`}
      {showSample && (
        <span className="communication-chip-preview" aria-hidden="true">
          <img src={sample} alt="" width={100} height={100} />
        </span>
      )}
    </button>
  );
  return showSample ? chip : <Tooltip content={titleParts.join(" · ")}>{chip}</Tooltip>;
}

/** Insert-placeholder chips, grouped into readable sections (Attendee/Event/Ticket & QR/Wallet/
 * Branding) instead of one long flat row - a placeholder outside every fixed group (a custom
 * per-event image asset token) falls into its own trailing "Images" group. */
function PlaceholderChips({
  allowedPlaceholders,
  imagePlaceholders,
  requiredPlaceholders,
  onInsertPlaceholder,
  eventId,
  logoUrl,
}: Readonly<{
  allowedPlaceholders: string[];
  imagePlaceholders: string[];
  requiredPlaceholders: string[];
  onInsertPlaceholder: (name: string) => void;
  eventId: string;
  /** Resolved real branding (event -> organization -> "") - shown as-is when configured; no
   * preview at all (falls back to the generic photo icon) when neither scope has one set, since
   * there's no further built-in default to show. */
  logoUrl: string;
}>) {
  const allowedSet = new Set(allowedPlaceholders);
  const grouped = new Set<string>();
  const groups = PLACEHOLDER_GROUPS.map((g) => ({
    label: g.label,
    names: g.names.filter((n) => allowedSet.has(n)),
  })).filter((g) => g.names.length > 0);
  groups.forEach((g) => g.names.forEach((n) => grouped.add(n)));
  const custom = allowedPlaceholders.filter((n) => !grouped.has(n));
  if (custom.length > 0) groups.push({ label: "Images", names: custom });

  // Only for placeholders that actually render as <img src>, i.e. IMAGE_PLACEHOLDERS (see
  // packages/mail-templates/src/placeholders.ts) - apple_wallet_url/google_wallet_url are link
  // values (an <mj-button href>, same category as ticket_url), not images, so a picture-style
  // preview would wrongly imply inserting the chip renders a picture. They keep the plain
  // icon+tooltip treatment instead (WALLET_PLACEHOLDERS' ti-ticket icon, below).
  //
  // The real per-event/org values a send would actually use - not samples. qr_image_url has no
  // real-until-sent equivalent (it's generated per attendee), so it keeps an illustrative sample
  // instead (see CHIP_QR_SAMPLE_DATA_URI). event_map_url always points at the real static-map
  // route; PlaceholderChip falls back to the generic icon itself if that 404s (no location set).
  // header_image_url is in HIDDEN_PLACEHOLDERS (no insert chip), so no sample entry is needed.
  const samples: Record<string, string> = {
    qr_image_url: CHIP_QR_SAMPLE_DATA_URI,
    event_map_url: `/m/${encodeURIComponent(eventId)}.png`,
  };
  if (logoUrl) samples.logo_url = logoUrl;

  const showWalletNotice = groups.some((g) => g.label === "Wallet");

  return (
    <>
      {groups.map((group) => (
        <div key={group.label} className="communication-ph-row">
          <span className="communication-overline">{group.label}</span>
          <div className="communication-chips">
            {group.names.map((p) => (
              <PlaceholderChip
                key={p}
                name={p}
                isImage={imagePlaceholders.includes(p)}
                isRequired={requiredPlaceholders.includes(p)}
                onInsert={onInsertPlaceholder}
                sample={samples[p]}
              />
            ))}
          </div>
        </div>
      ))}
      {showWalletNotice && (
        <Notice variant="info" className="communication-wallet-notice">
          Wallet chips insert an Add to Wallet badge button. Apple and Google Wallet links are not
          generated yet, so do not use these badges in messages you send to attendees.
        </Notice>
      )}
    </>
  );
}

/** Placeholder chips, subject/format/body editor fields, validation errors, and the
 * preview/save actions row for the currently selected template.
 *
 * Lazy-loaded from CommunicationPage (see the `lazy(() => import(...))` there): this is the only
 * place CodeMirror and its language/lint/autocomplete extensions are needed, and pulling them in
 * statically pushed CommunicationPage's own chunk over Vite's 500kB warning threshold even though
 * most visits to the page never open the Templates tab at all (see issue #1331). */
export function TemplateEditorCard({
  event,
  activeKey,
  activeTemplateName,
  allowedPlaceholders,
  imagePlaceholders,
  requiredPlaceholders,
  onInsertPlaceholder,
  brandingLogoUrl,
  subjectRef,
  subject,
  setSubject,
  setActiveField,
  editorSnapshotMissing,
  format,
  onRequestFormat,
  bodyRef,
  body,
  setBody,
  validationErrors,
  saving,
  templateActionBusy,
  isDirty,
  saveButtonLabel,
  onSave,
}: Readonly<{
  event: EventDto;
  activeKey: string;
  activeTemplateName: string;
  allowedPlaceholders: string[];
  imagePlaceholders: string[];
  requiredPlaceholders: string[];
  onInsertPlaceholder: (name: string) => void;
  brandingLogoUrl: string;
  subjectRef: RefObject<HTMLInputElement | null>;
  subject: string;
  setSubject: Dispatch<SetStateAction<string>>;
  setActiveField: Dispatch<SetStateAction<ActiveField>>;
  editorSnapshotMissing: boolean;
  format: TemplateFormat;
  onRequestFormat: (next: TemplateFormat) => void;
  bodyRef: RefObject<ReactCodeMirrorRef | null>;
  body: string;
  setBody: Dispatch<SetStateAction<string>>;
  validationErrors: string[];
  saving: boolean;
  templateActionBusy: boolean;
  isDirty: boolean;
  saveButtonLabel: string;
  onSave: () => void;
}>) {
  // The lint's "known" set is a superset of the chip list's own allowedPlaceholders: chips hide
  // header_image_url (HIDDEN_PLACEHOLDERS - no way to fill it in through this UI), but a template
  // that already contains it is still genuinely valid server-side, so the linter must not flag it.
  const knownPlaceholders = useMemo(
    () => new Set([...allowedPlaceholders, ...HIDDEN_PLACEHOLDERS]),
    [allowedPlaceholders],
  );

  // Autocomplete suggestions use the chip-visible list (not knownPlaceholders' HIDDEN_PLACEHOLDERS
  // superset) - same reasoning as the chips themselves: header_image_url has no way to be filled
  // in through this UI, so it shouldn't be actively suggested for insertion, just tolerated by the
  // linter when a template already contains one. Same description text the chip tooltips show.
  const placeholderCompletionItems = useMemo(
    () =>
      allowedPlaceholders.map((name) => ({
        name,
        description: placeholderDescription(name, imagePlaceholders.includes(name)),
      })),
    [allowedPlaceholders, imagePlaceholders],
  );

  // Recomputed only when `format`/`knownPlaceholders`/`placeholderCompletionItems` change, not on
  // every keystroke (`body` re-renders this component on every keystroke too) - a fresh
  // extensions array reference on every render would make CodeMirror reconfigure itself
  // constantly instead of just applying the controlled `value`. Content edits alone still re-lint
  // live - that's the linter extension's own job (debounced internally), not something this
  // recompute needs to drive.
  const bodyExtensions = useMemo(
    () => [
      html(),
      // Visually marks {{placeholder}} tokens so they stand out from surrounding static markup -
      // see placeholderHighlightViewPlugin.ts for the technique and edge cases it handles.
      placeholderHighlightViewPlugin,
      // Flags a {{typo}} placeholder inline, live, with the same "Unknown placeholder: X" wording
      // the server returns on Save/Preview - see placeholderUnknownLint.ts.
      createUnknownPlaceholderLinter(knownPlaceholders),
      // Typing "{{" offers this template's own placeholders instead of only being reachable via
      // a chip click above the editor - see placeholderAutocomplete.ts (also the reason
      // basicSetup disables its own autocompletion below: lang-html's tag/attribute completions
      // would otherwise compete with this one).
      createPlaceholderAutocomplete(placeholderCompletionItems),
      // Stops closeBrackets from auto-closing "{" - see placeholderBracesConfig's own doc comment
      // for why that otherwise matters here specifically (a real live-preview 400, not just a
      // cosmetic issue).
      placeholderBracesConfig,
      // CodeMirror's own default tooltip-positioning space is the full 0..clientWidth/clientHeight
      // viewport with no margin of its own - confirmed empirically on a 375px-wide phone, where
      // the autocomplete popup's right edge landed at exactly 375px (real PO report). Shrinking
      // the space it's allowed to use by 16px on every side keeps it (and the lint hover tooltip,
      // which shares the same positioning extension) off the screen edge on narrow viewports.
      tooltips({
        tooltipSpace: (view) => {
          const doc = view.dom.ownerDocument.documentElement;
          return { top: 16, bottom: doc.clientHeight - 16, left: 16, right: doc.clientWidth - 16 };
        },
      }),
      EditorView.contentAttributes.of({
        id: "communication-body",
        "aria-label": format === "mjml" ? "MJML body" : "HTML body",
      }),
      // Mirrors the old textarea's Tab handling: plain Tab inserts two spaces (code-editor
      // habit) instead of the browser's default focus-cycling; Shift+Tab is deliberately left
      // unbound (rather than using CodeMirror's own indentWithTab, which traps both directions)
      // so keyboard users can still Shift+Tab out of the editor. Doesn't conflict with the
      // placeholder-completion popup above - its own keymap binds Enter/Escape/arrows, not Tab.
      keymap.of([
        {
          key: "Tab",
          preventDefault: true,
          run: (view) => {
            view.dispatch(view.state.replaceSelection("  "));
            return true;
          },
        },
      ]),
    ],
    [format, knownPlaceholders, placeholderCompletionItems],
  );

  return (
    <Card
      title={activeTemplateName === "ticket" ? "Ticket template" : "Template"}
      actions={
        <Segmented
          ariaLabel="Template format"
          className="communication-format-toggle"
          value={format}
          onChange={onRequestFormat}
          options={TEMPLATE_FORMAT_OPTIONS}
        />
      }
    >
      <p className="communication-format-hint muted">
        Changing format does not convert the template body. Switching a non-empty template asks
        for confirmation first.
      </p>

      <PlaceholderChips
        allowedPlaceholders={allowedPlaceholders}
        imagePlaceholders={imagePlaceholders}
        requiredPlaceholders={requiredPlaceholders}
        onInsertPlaceholder={onInsertPlaceholder}
        eventId={event.id}
        logoUrl={brandingLogoUrl}
      />

      <Tooltip
        content={isEventArchived(event) ? ARCHIVED_ACTION_TOOLTIP : undefined}
        className="communication-editor-fieldset-wrapper"
      >
        <fieldset className="communication-editor-fieldset" disabled={isEventArchived(event)}>
          <Input
            ref={subjectRef}
            label="Subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            onFocus={() => setActiveField("subject")}
            onClick={() => setActiveField("subject")}
            disabled={editorSnapshotMissing}
          />
        </fieldset>
      </Tooltip>

      <Tooltip
        content={isEventArchived(event) ? ARCHIVED_ACTION_TOOLTIP : undefined}
        className="communication-editor-fieldset-wrapper"
      >
        <fieldset className="communication-editor-fieldset" disabled={isEventArchived(event)}>
          <div className="communication-body-field at-field">
            {/* Fieldset `disabled` only cascades to native form controls (input/textarea/select) -
                CodeMirror's contenteditable root isn't one, so the archived/missing-snapshot states
                below are wired explicitly via `editable` instead of relying on that cascade. Native
                label-click-to-focus doesn't reach a contenteditable div either, hence the explicit
                onClick. */}
            <label // NOSONAR - onClick is a mouse-only convenience widening the label's own click-to-focus hit area (see comment above); the editor itself is an independently keyboard-focusable role="textbox" a keyboard user tabs to directly, so nothing here is keyboard-inaccessible
              className="at-label"
              htmlFor="communication-body"
              onClick={() => bodyRef.current?.view?.focus()}
            >
              {format === "mjml" ? "MJML body" : "HTML body"}
            </label>
            <CodeMirror
              // Forces a fresh EditorView (and with it, a fresh undo history) whenever the admin
              // switches to a different template or toggles MJML/HTML format - @uiw/react-codemirror
              // otherwise keeps the SAME instance across a controlled `value` swap (it applies the
              // new value as just another transaction, same as any edit), so Ctrl+Z right after
              // switching templates could undo straight through into the PREVIOUS template's body -
              // which could then get saved over the one actually being edited (real bot-review find).
              // A switch to a DIFFERENT event doesn't need event.id here too, even though activeKey
              // alone can stay unchanged across one (e.g. both events fall back to the same default
              // virtual-ticket template): CommunicationPage's own `if (loading) return ...` (below,
              // near the component's end) unconditionally unmounts this entire subtree on every
              // eventId change while its own template fetch is in flight, which already forces a
              // fresh CodeMirror mount with a blank undo history - proven by
              // "resets the body editor's undo history on an event switch" in
              // CommunicationPage.placeholders.test.tsx, which passes with or without event.id in
              // this key (verified both ways; a second bot-review report of this same finding is a
              // false positive for that reason).
              key={`${activeKey}-${format}`}
              ref={bodyRef}
              className={[
                "communication-code-editor",
                (isEventArchived(event) || editorSnapshotMissing) && "communication-code-editor--disabled",
              ]
                .filter(Boolean)
                .join(" ")}
              value={body}
              // Height comes from CSS (.communication-code-editor .cm-editor), not this prop -
              // it's drag-resizable there (`resize: vertical`), which a prop-set fixed height
              // would fight against.
              theme="light"
              // Turns off basicSetup's own autocompletion instance, which would source
              // suggestions from @codemirror/lang-html's language data - built for standard HTML
              // tags/attributes, not MJML's custom <mj-*> elements, so wrong/noisy here.
              // createPlaceholderAutocomplete (in bodyExtensions above) brings autocompletion back
              // as its own separate instance, scoped to only ever suggest {{placeholder}} tokens.
              basicSetup={{ autocompletion: false }}
              extensions={bodyExtensions}
              editable={!isEventArchived(event) && !editorSnapshotMissing}
              indentWithTab={false}
              onChange={setBody}
              onFocus={() => setActiveField("body")}
            />
          </div>
        </fieldset>
      </Tooltip>

      {validationErrors.length === 1 && (
        <Notice variant="error" role="alert" className="communication-errors">
          {validationErrors[0]}
        </Notice>
      )}
      {validationErrors.length > 1 && (
        <Notice variant="error" role="alert" className="communication-errors">
          <ul>
            {validationErrors.map((msg) => (
              <li key={msg}>{msg}</li>
            ))}
          </ul>
        </Notice>
      )}

      <div className="communication-actions">
        <ArchivedGuard
          event={event}
          reasonId="save-template-reason"
          disabled={saving || templateActionBusy || !isDirty || editorSnapshotMissing}
        >
          {(guard) => (
            <Button
              variant="primary"
              icon={<i className="ti ti-device-floppy" aria-hidden="true" />}
              onClick={onSave}
              {...guard}
            >
              {saveButtonLabel}
            </Button>
          )}
        </ArchivedGuard>
      </div>
    </Card>
  );
}
