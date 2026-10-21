import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import type { Editor } from "@tiptap/core";
import Bold from "@tiptap/extension-bold";
import Document from "@tiptap/extension-document";
import Heading from "@tiptap/extension-heading";
import Link from "@tiptap/extension-link";
import { BulletList, ListItem, OrderedList } from "@tiptap/extension-list";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import { UndoRedo } from "@tiptap/extensions";
import { Button, IconButton, Input, Tooltip } from "@admitto/ui";
import { legalLinkFromInput, legalTextIsBlank, normalizeLegalHtml, safeLegalHref } from "./legalHtml.js";
import "./legal-editor.css";

/**
 * A list item that leaves Tab alone. Tab indents an item by default, which keeps the keyboard in the editor and changes the
 * text of a person who only wanted to move on; Enter and Shift+Tab stay.
 */
const LegalListItem = ListItem.extend({
  addKeyboardShortcuts() {
    return {
      Enter: () => this.editor.commands.splitListItem(this.name),
      "Shift-Tab": () => this.editor.commands.liftListItem(this.name),
    };
  },
});

/** A link that carries an `href` and nothing else (the server keeps nothing else), and only an allowed one. */
const LegalLink = Link.extend({
  addAttributes() {
    return { href: { default: null } };
  },
}).configure({
  openOnClick: false,
  autolink: false,
  linkOnPaste: false,
  // The link mark's own defaults (target _blank, rel, class) are switched off: configure() merges, so they are set to nothing.
  HTMLAttributes: { target: null, rel: null, class: null },
  isAllowedUri: (url) => safeLegalHref(url) !== null,
});

/**
 * What a legal text may be made of: paragraphs, two levels of heading, bold, bulleted and numbered lists and links
 * (http, https and mailto). Nothing else exists in this editor, so nothing else can be pasted into it: a pasted page keeps
 * its words and loses its italics, tables and images. The server's list is wider (apps/web/src/legal/sanitize-legal-html.ts);
 * everything the editor writes is on it.
 */
export function createLegalEditorExtensions() {
  return [
    Document,
    Paragraph,
    Text,
    Heading.configure({ levels: [2, 3] }),
    Bold,
    BulletList,
    OrderedList,
    LegalListItem,
    UndoRedo,
    LegalLink,
  ];
}

/** The text of an editor in the form that is compared and sent: "" when there is no text at all. */
export function serializeLegalEditor(editor: Editor): string {
  if (legalTextIsBlank(editor.state.doc.textContent)) return "";
  return normalizeLegalHtml(editor.getHTML());
}

/** "edit": typing and the toolbar. "busy": a save is on its way, so nothing changes under it. "view": an archived event. */
export type LegalEditorMode = "edit" | "busy" | "view";

export interface LegalHtmlEditorProps {
  /** The text as it is stored. It is read once: a different text is another editor (a `key`). */
  initialHtml: string;
  /** The id of the visible label that names the text field. */
  labelledBy: string;
  describedBy?: string;
  mode: LegalEditorMode;
  /** Called once the editor is there, and after every change, with the text as it would be sent. */
  onHtml: (html: string) => void;
}

function ToolbarButton({
  label,
  icon,
  pressed,
  disabled,
  onClick,
}: Readonly<{ label: string; icon: string; pressed: boolean; disabled: boolean; onClick: () => void }>) {
  return (
    <Tooltip content={label}>
      <IconButton
        label={label}
        icon={<i className={`ti ti-${icon}`} aria-hidden="true" />}
        aria-pressed={pressed}
        className="legal-toolbar__button"
        disabled={disabled}
        onClick={onClick}
      />
    </Tooltip>
  );
}

/** The link field under the toolbar: it applies to the words that are selected, or changes the link the caret is in. */
function LinkForm({ editor, onClose }: Readonly<{ editor: Editor; onClose: () => void }>) {
  const [address, setAddress] = useState<string>(() => String(editor.getAttributes("link")["href"] ?? ""));
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const inLink = editor.isActive("link");

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function apply() {
    const link = legalLinkFromInput(address);
    if ("error" in link) {
      setError(link.error);
      return;
    }
    if (editor.state.selection.empty && !inLink) {
      setError("Select the words you want to turn into a link first.");
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: link.href }).run();
    onClose();
  }

  function remove() {
    editor.chain().focus().extendMarkRange("link").unsetLink().run();
    onClose();
  }

  function onEscape(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    onClose();
  }

  function onFieldKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      apply();
    } else {
      onEscape(event);
    }
  }

  return (
    // Enter in the field applies the link, and Escape in the field or on a button leaves without it.
    <fieldset className="legal-link-form" aria-label="Link">
      <Input
        ref={inputRef}
        label="Link address"
        type="text"
        inputMode="url"
        autoComplete="off"
        placeholder="https://example.com"
        value={address}
        error={error ?? undefined}
        onKeyDown={onFieldKeyDown}
        onChange={(event) => {
          setAddress(event.target.value);
          setError(null);
        }}
      />
      <div className="legal-link-form__actions">
        <Button type="button" size="sm" onClick={apply} onKeyDown={onEscape}>
          Apply
        </Button>
        {inLink && (
          <Button type="button" size="sm" variant="secondary" onClick={remove} onKeyDown={onEscape}>
            Remove link
          </Button>
        )}
        <Button type="button" size="sm" variant="ghost" onClick={onClose} onKeyDown={onEscape}>
          Cancel
        </Button>
      </div>
    </fieldset>
  );
}

function Toolbar({ editor, disabled }: Readonly<{ editor: Editor; disabled: boolean }>) {
  const [linkOpen, setLinkOpen] = useState(false);
  const active = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      heading: current.isActive("heading", { level: 2 }),
      subheading: current.isActive("heading", { level: 3 }),
      bold: current.isActive("bold"),
      bullet: current.isActive("bulletList"),
      ordered: current.isActive("orderedList"),
      link: current.isActive("link"),
    }),
  });

  function closeLink() {
    setLinkOpen(false);
    editor.commands.focus();
  }

  return (
    <>
      <fieldset aria-label="Text formatting" className="legal-toolbar">
        <ToolbarButton
          label="Heading"
          icon="h-2"
          pressed={active.heading}
          disabled={disabled}
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        />
        <ToolbarButton
          label="Subheading"
          icon="h-3"
          pressed={active.subheading}
          disabled={disabled}
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        />
        <ToolbarButton
          label="Bold"
          icon="bold"
          pressed={active.bold}
          disabled={disabled}
          onClick={() => editor.chain().focus().toggleBold().run()}
        />
        <ToolbarButton
          label="Bulleted list"
          icon="list"
          pressed={active.bullet}
          disabled={disabled}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        />
        <ToolbarButton
          label="Numbered list"
          icon="list-numbers"
          pressed={active.ordered}
          disabled={disabled}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        />
        <ToolbarButton
          label="Link"
          icon="link"
          pressed={active.link || linkOpen}
          disabled={disabled}
          onClick={() => (linkOpen ? closeLink() : setLinkOpen(true))}
        />
      </fieldset>
      {linkOpen && !disabled && <LinkForm editor={editor} onClose={closeLink} />}
    </>
  );
}

/**
 * The visual editor of a legal text (Tiptap, on ProseMirror), loaded only when a text is opened (`React.lazy` in
 * LegalTextEditor.tsx): headings, bold, lists and links, and nothing else. The editing surface is a `textbox` that
 * is named by the visible label, and Tab leaves it.
 */
export function LegalHtmlEditor({ initialHtml, labelledBy, describedBy, mode, onHtml }: Readonly<LegalHtmlEditorProps>) {
  const onHtmlRef = useRef(onHtml);
  useEffect(() => {
    onHtmlRef.current = onHtml;
  });
  const editable = mode === "edit";
  const extensions = useMemo(createLegalEditorExtensions, []);
  const editor = useEditor({
    extensions,
    content: initialHtml,
    editable,
    onCreate: ({ editor: created }) => onHtmlRef.current(serializeLegalEditor(created)),
    onUpdate: ({ editor: changed }) => onHtmlRef.current(serializeLegalEditor(changed)),
  });

  useEffect(() => {
    editor?.setEditable(editable);
  }, [editor, editable]);

  useEffect(() => {
    // The attributes that name the field, and say that it cannot be typed in while it is read-only.
    editor?.setOptions({
      editorProps: {
        attributes: {
          "aria-labelledby": labelledBy,
          "aria-multiline": "true",
          ...(describedBy ? { "aria-describedby": describedBy } : {}),
          ...(editable ? {} : { "aria-readonly": "true" }),
        },
      },
    });
  }, [editor, labelledBy, describedBy, editable]);

  if (!editor) return null;
  return (
    <div className="legal-editor-field">
      {mode !== "view" && <Toolbar editor={editor} disabled={mode === "busy"} />}
      <div className="legal-editor-surface">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
