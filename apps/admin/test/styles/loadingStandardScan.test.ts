import { describe, expect, it } from "vitest";
import { countLoadingViolations } from "./loadingStandardScan.js";

const code = (source: string) => countLoadingViolations(source, "code");

describe("loading-standard scanner: what counts as a violation", () => {
  it("counts bare Loading text, however it is written", () => {
    expect(code("<p>Loading…</p>")["bare-loading-text"]).toBe(1);
    expect(code("<p>Loading check-in events…</p>")["bare-loading-text"]).toBe(1);
    expect(code("<p>Loading...</p>")["bare-loading-text"]).toBe(1);
  });

  it("counts a hand-made busy label swap", () => {
    expect(code('{saving ? "Saving…" : "Save"}')["busy-label-swap"]).toBe(1);
    expect(code("{saving ? 'Sending…' : 'Send'}")["busy-label-swap"]).toBe(1);
  });

  it("counts a busy label in either branch of the ternary", () => {
    expect(code('{!saving ? "Save" : "Saving…"}')["busy-label-swap"]).toBe(1);
    expect(code("{!sending ? 'Send' : 'Sending…'}")["busy-label-swap"]).toBe(1);
    expect(code('{!saving ? label : "Saving…"}')["busy-label-swap"]).toBe(1);
    expect(code('{!saving ? <b>Save</b> : "Saving…"}')["busy-label-swap"]).toBe(1);
    expect(code("{!saving ? `Save ${n}` : `Saving ${n}…`}")["busy-label-swap"]).toBe(1);
  });

  it("counts a busy label on its own line, the way Prettier lays a long ternary out", () => {
    const source = ["<Button>", "  {!saving", '    ? "Save changes"', '    : "Saving changes…"}', "</Button>"].join("\n");
    expect(code(source)["busy-label-swap"]).toBe(1);
  });

  it("counts a nested ternary and one inside a template literal", () => {
    expect(code('{a ? b ? "x" : "Saving…" : "Save"}')["busy-label-swap"]).toBe(1);
    expect(code("const label = `${!saving ? \"Save\" : \"Saving…\"} changes`;")["busy-label-swap"]).toBe(1);
  });

  it("counts a ternary once, however many of its branches are busy labels", () => {
    expect(code('{busy ? "Saving…" : "Sending…"}')["busy-label-swap"]).toBe(1);
    expect(code('{uploading && !saving ? "Uploading…" : "Saving…"}')["busy-label-swap"]).toBe(1);
  });

  it("is not fooled by a colon or a question mark inside the idle label", () => {
    expect(code('{!saving ? "Save: now" : "Saving…"}')["busy-label-swap"]).toBe(1);
    expect(code('{!saving ? "Save it?" : "Saving…"}')["busy-label-swap"]).toBe(1);
  });

  it("is not fooled by an apostrophe in JSX text on the same line", () => {
    expect(code('<p>Don\'t {!saving ? "Save" : "Saving…"} can\'t</p>')["busy-label-swap"]).toBe(1);
  });

  it("counts hand-rolled spinner and shimmer CSS", () => {
    expect(countLoadingViolations("@keyframes my-spin { to { transform: rotate(1turn); } }", "css")["hand-rolled-spinner-css"]).toBe(1);
    expect(countLoadingViolations(".x { animation: at-spin 1s linear infinite; }", "css")["hand-rolled-spinner-css"]).toBe(1);
    expect(countLoadingViolations("@keyframes list-shimmer { to { opacity: 0; } }", "css")["hand-rolled-spinner-css"]).toBe(1);
  });

  it("does not count decorative animations or comments", () => {
    expect(countLoadingViolations("@keyframes overview-live-pulse { to { opacity: 0; } }", "css")["hand-rolled-spinner-css"]).toBe(0);
    expect(code("// shows Loading… while it waits\nconst a = 1;")["bare-loading-text"]).toBe(0);
    expect(code("/* {busy ? 'Saving…' : 'Save'} */")["busy-label-swap"]).toBe(0);
  });
});

describe("loading-standard scanner: ellipsis text that is not a busy label", () => {
  it("does not count a prompt or placeholder that ends in an ellipsis", () => {
    expect(code('const p = empty ? "None available" : "Select organization…";')["busy-label-swap"]).toBe(0);
    expect(code('const p = field.required ? "Choose…" : "-";')["busy-label-swap"]).toBe(0);
    expect(code('<Select placeholder="Search roles…" />')["busy-label-swap"]).toBe(0);
  });

  it("does not read a `?.`, a `??` or an optional property as a ternary", () => {
    expect(code('const s = { a: cond ?? 1, b: "Saving…" };')["busy-label-swap"]).toBe(0);
    expect(code('const s = { p: x?.y, q: "Saving…" };')["busy-label-swap"]).toBe(0);
    expect(code('type P = { onSave?: () => void; label: "Saving…" };')["busy-label-swap"]).toBe(0);
    expect(code('type P = { label?: "Saving…" };')["busy-label-swap"]).toBe(0);
  });

  it("does not read a question mark in JSX text as the start of a ternary", () => {
    expect(code('const t = <p>Ready? Go</p>;\nconst l: "Saving…" = x;')["busy-label-swap"]).toBe(0);
  });

  it("does not read an object property in the true branch as the false branch", () => {
    expect(code('const cfg = ok ? { label: "Saving…" } : undefined;')["busy-label-swap"]).toBe(0);
  });

  it("does not join a `?` to a busy literal in a later statement or block", () => {
    expect(code('const a = b ? c : d;\nconst s = { label: "Saving…" };')["busy-label-swap"]).toBe(0);
    expect(code('const a = b ? { x: 1 } : d;\nconst s = { label: "Saving…" };')["busy-label-swap"]).toBe(0);
    expect(code(`const a = b ? ${"x".repeat(300)} : "Saving…";`)["busy-label-swap"]).toBe(0);
  });
});

describe("loading-standard scanner: forms the standard itself allows", () => {
  it("does not count loading text that is an aria-label (text for assistive tech)", () => {
    expect(code('<output aria-label="Loading…"></output>')["bare-loading-text"]).toBe(0);
    expect(code("<output aria-label={'Loading events…'}></output>")["bare-loading-text"]).toBe(0);
  });

  it("does not count the verb choice inside a Button's loadingLabel", () => {
    const source = '<Button loading={busy} loadingLabel={isCreate ? "Creating…" : "Saving…"}>{isCreate ? "Create" : "Save"}</Button>';
    expect(code(source)["busy-label-swap"]).toBe(0);
  });

  it("does not count the verb choice inside loadingLabel when the idle verb comes first", () => {
    expect(code('<Button loading={busy} loadingLabel={!creating ? "Saving…" : "Creating…"}>Go</Button>')["busy-label-swap"]).toBe(0);
  });

  it("copes with nested braces and strings inside the allowed attribute", () => {
    const source = "<Button loadingLabel={pick({ a: 1 }) ? \"Creating…\" : \"Saving…\"} onClick={() => {}}>Go</Button>";
    expect(code(source)["busy-label-swap"]).toBe(0);
  });

  it("still counts real violations next to the allowed forms", () => {
    const source = [
      '<Button loading loadingLabel={a ? "Creating…" : "Saving…"}>Save</Button>',
      '<span aria-label="Loading…">{busy ? "Working…" : "Done"}</span>',
      "<p>Loading…</p>",
    ].join("\n");
    expect(code(source)["busy-label-swap"]).toBe(1);
    expect(code(source)["bare-loading-text"]).toBe(1);
  });

  it("does not mistake a longer attribute name for an allowed one", () => {
    // `data-aria-label=` is not `aria-label=`; only the real attribute is exempt.
    expect(code('<p data-aria-label="Loading…">x</p>')["bare-loading-text"]).toBe(1);
  });
});

describe("error-state scanner: a failed load must be announced", () => {
  const count = (
    source: string,
    rule: "error-state-not-an-alert" | "retry-outside-an-alert" | "retry-in-a-raw-button" | "raw-button-busy-disabled",
  ) => code(source)[rule];

  it("counts an EmptyState with a Retry, or a 'Could not load' title, that has no variant=\"error\"", () => {
    expect(count('<EmptyState title="Could not load attendees" description={error} />', "error-state-not-an-alert")).toBe(1);
    expect(
      count('<EmptyState title="Oops" action={<Button variant="secondary" onClick={retry}>Retry</Button>} />', "error-state-not-an-alert"),
    ).toBe(1);
    expect(
      count('<EmptyState title={denied ? "No access" : "Could not load template"} description={error} />', "error-state-not-an-alert"),
    ).toBe(1);
  });

  it("does not count an error EmptyState, nor a plain empty state", () => {
    expect(count('<EmptyState variant="error" title="Could not load attendees" description={error} />', "error-state-not-an-alert")).toBe(0);
    expect(
      count(
        ['<EmptyState', '  variant="error"', '  title="Could not load x"', '  action={<Button variant="secondary" onClick={retry}>Retry</Button>}', '/>'].join("\n"),
        "error-state-not-an-alert",
      ),
    ).toBe(0);
    expect(count('<EmptyState title="No attendees yet" description="Import a file." />', "error-state-not-an-alert")).toBe(0);
  });

  it("is not fooled by the variant of the Retry button inside the action", () => {
    // `variant="error"` only counts on the EmptyState itself, never on a Button inside its action.
    expect(
      count('<EmptyState title="Could not load x" action={<Button variant="error" onClick={retry}>Retry</Button>} />', "error-state-not-an-alert"),
    ).toBe(1);
  });

  it("counts an error EmptyState whose variant is anything but \"error\"", () => {
    expect(count('<EmptyState variant="default" title="Could not load x" />', "error-state-not-an-alert")).toBe(1);
  });

  it("does not take another component, whose name starts the same, for an EmptyState or a button", () => {
    expect(count('<EmptyStateList title="Could not load x" />', "error-state-not-an-alert")).toBe(0);
    expect(count('<button-group disabled={busy} />', "raw-button-busy-disabled")).toBe(0);
    expect(count('<buttons disabled={busy} />', "raw-button-busy-disabled")).toBe(0);
  });

  it("counts a Retry that is far below the alert, not the one that sits right in it", () => {
    const far = ['<div role="alert">', "  <p>{error}</p>", "</div>", ...Array.from({ length: 30 }, () => "<p>filler</p>"), "<Button onClick={load}>", "  Retry", "</Button>"].join("\n");
    expect(count(far, "retry-outside-an-alert")).toBe(1);
  });

  it("counts a Retry that sits in no alert, EmptyState or Notice", () => {
    const bare = ['<div className="status">', "  <p>{error}</p>", "  <Button onClick={load}>", "    Retry", "  </Button>", "</div>"].join("\n");
    expect(count(bare, "retry-outside-an-alert")).toBe(1);
    expect(count('<div className="status"><p>{error}</p><Button onClick={load}>Retry</Button></div>', "retry-outside-an-alert")).toBe(1);
  });

  it("does not count a Retry inside an alert container or an EmptyState action", () => {
    const alert = ['<div className="status" role="alert">', "  <p>{error}</p>", "  <Button onClick={load}>", "    Retry", "  </Button>", "</div>"].join("\n");
    expect(count(alert, "retry-outside-an-alert")).toBe(0);
    expect(count('<div className="status" role="alert"><p>{error}</p><Button onClick={load}>Retry</Button></div>', "retry-outside-an-alert")).toBe(0);
    const empty = ['<EmptyState', '  title="Could not load x"', "  action={", "    <Button onClick={load}>", "      Retry", "    </Button>", "  }", "/>"].join("\n");
    expect(count(empty, "retry-outside-an-alert")).toBe(0);
  });

  it("does not count a Retry in the action of a Notice that has role=\"alert\" itself, wherever the role sits", () => {
    const before = ['<Notice variant="error" role="alert" action={', "  <Button onClick={load}>Retry</Button>", "}>", "  {error}", "</Notice>"].join("\n");
    expect(count(before, "retry-outside-an-alert")).toBe(0);
    // The role may come after the action prop, past the line the Retry is on.
    const after = ['<Notice variant="error" action={', "  <Button onClick={load}>Retry</Button>", '} role="alert">', "  {error}", "</Notice>"].join("\n");
    expect(count(after, "retry-outside-an-alert")).toBe(0);
    expect(count('<Notice variant="error" role={"alert"} action={<Button onClick={load}>Retry</Button>}>{error}</Notice>', "retry-outside-an-alert")).toBe(0);
  });

  it("counts a Retry in the action of a Notice that leaves its role out, or gives it another one", () => {
    // A Notice leaves its role to the caller, so the component name alone announces nothing.
    const bare = ['<Notice variant="error" action={', "  <Button onClick={load}>Retry</Button>", "}>", "  {error}", "</Notice>"].join("\n");
    expect(count(bare, "retry-outside-an-alert")).toBe(1);
    expect(count('<Notice variant="error" role="status" action={<Button onClick={load}>Retry</Button>}>{error}</Notice>', "retry-outside-an-alert")).toBe(1);
    // data-role and aria-role are not a role, and a role inside another prop is not the Notice's own.
    expect(count('<Notice variant="error" data-role="alert" action={<Button onClick={load}>Retry</Button>}>{error}</Notice>', "retry-outside-an-alert")).toBe(1);
    expect(count('<Notice variant="error" aria-role="alert" action={<Button onClick={load}>Retry</Button>}>{error}</Notice>', "retry-outside-an-alert")).toBe(1);
    const nested = ['<Notice', '  variant="error"', '  title={<span role="alert">Failed</span>}', "  action={<Button onClick={load}>Retry</Button>}", ">", "  {error}", "</Notice>"].join("\n");
    expect(count(nested, "retry-outside-an-alert")).toBe(1);
  });

  it("accepts every spelling of role=\"alert\" JSX allows", () => {
    for (const role of ['role="alert"', "role='alert'", 'role={"alert"}', "role={'alert'}", "role={`alert`}"]) {
      expect(count(`<Notice variant="error" ${role} action={<Button onClick={load}>Retry</Button>}>{error}</Notice>`, "retry-outside-an-alert")).toBe(0);
      expect(count(`<div ${role}><Button onClick={load}>Retry</Button></div>`, "retry-outside-an-alert")).toBe(0);
    }
  });

  it("accepts any element that carries the role itself, not only a Notice, wherever the role sits among its props", () => {
    const banner = ['<Banner variant="error" action={', "  <Button onClick={load}>Retry</Button>", '} role="alert">', "  {error}", "</Banner>"].join("\n");
    expect(count(banner, "retry-outside-an-alert")).toBe(0);
    // A component with an action prop that is not an alert announces nothing.
    expect(count('<Card action={<Button onClick={load}>Retry</Button>}>x</Card>', "retry-outside-an-alert")).toBe(1);
  });

  it("only counts an alert that still encloses the Retry, however long the alert is", () => {
    const closed = ['<p role="alert">{formError}</p>', '<p className="hint">', "  {ticketTypesError}", "  <button type=\"button\" onClick={retry}>", "    Retry", "  </button>", "</p>"].join("\n");
    expect(count(closed, "retry-outside-an-alert")).toBe(1);
    const long = ['<div role="alert">', ...Array.from({ length: 30 }, () => "  <p>detail</p>"), "  <Button onClick={load}>Retry</Button>", "</div>"].join("\n");
    expect(count(long, "retry-outside-an-alert")).toBe(0);
    const nestedSame = ['<div role="alert">', "  <div>", "    <p>inner</p>", "  </div>", "  <Button onClick={load}>Retry</Button>", "</div>"].join("\n");
    expect(count(nestedSame, "retry-outside-an-alert")).toBe(0);
    const selfClosing = ['<Notice variant="error" role="alert" />', "<Button onClick={load}>Retry</Button>"].join("\n");
    expect(count(selfClosing, "retry-outside-an-alert")).toBe(1);
  });

  it("sees a Retry that follows an icon or an expression on its line, and every Retry on a line", () => {
    const icon = ['<div className="status">', "  <Button onClick={load}>", '    <i className="ti ti-refresh" aria-hidden="true" /> Retry', "  </Button>", "</div>"].join("\n");
    expect(count(icon, "retry-outside-an-alert")).toBe(1);
    expect(count('<button onClick={load}>{icon}Retry</button>', "retry-outside-an-alert")).toBe(1);
    const two = '<Notice role="alert" variant="error" action={<Button>Retry</Button>}>a</Notice><Notice variant="error" action={<Button>Retry</Button>}>b</Notice>';
    expect(count(two, "retry-outside-an-alert")).toBe(1);
  });

  it("is not swallowed by a tag that never ends (a stray quote in a trailing comment)", () => {
    const stray = ['<EmptyState', '  variant="error" // it\'s a failed load', '  title="Could not load x"', "/>", ...Array.from({ length: 30 }, () => "<p>filler</p>"), "<div>", "  <Button onClick={again}>Retry</Button>", "</div>"].join("\n");
    expect(count(stray, "retry-outside-an-alert")).toBe(1);
  });

  it("does not let an unrelated Notice or action prop above excuse a Retry that sits in no alert", () => {
    const unrelatedNotice = ['<Notice variant="info">Saved.</Notice>', '<div className="status">', "  <Button onClick={load}>Retry</Button>", "</div>"].join("\n");
    expect(count(unrelatedNotice, "retry-outside-an-alert")).toBe(1);
    const unrelatedAction = ['<Card action={<Button onClick={add}>Add</Button>}>', '  <div className="status">', "    <Button onClick={load}>Retry</Button>", "  </div>", "</Card>"].join("\n");
    expect(count(unrelatedAction, "retry-outside-an-alert")).toBe(1);
  });

  it("checks a Retry that is a child of a Notice against the role in the lines above it", () => {
    const withRole = ['<Notice variant="error" role="alert">', "  {error}", "  <Button onClick={load}>Retry</Button>", "</Notice>"].join("\n");
    expect(count(withRole, "retry-outside-an-alert")).toBe(0);
    const withoutRole = ['<Notice variant="error">', "  {error}", "  <Button onClick={load}>Retry</Button>", "</Notice>"].join("\n");
    expect(count(withoutRole, "retry-outside-an-alert")).toBe(1);
  });

  it("counts a Retry or Reload that is the label of a raw <button>, however it is classed or laid out", () => {
    expect(count('<p role="alert">{error} <button type="button" className="link-btn" onClick={retry}>Retry</button></p>', "retry-in-a-raw-button")).toBe(1);
    const spread = ['<div role="alert">', "  <button", '    type="button"', '    className="notif-bell__retry"', "    onClick={() => void load()}", "  >", "    Retry", "  </button>", "</div>"].join("\n");
    expect(count(spread, "retry-in-a-raw-button")).toBe(1);
    expect(count("<button onClick={retry}>Retry now</button>", "retry-in-a-raw-button")).toBe(1);
    expect(count("<button onClick={again}>Reload page</button>", "retry-in-a-raw-button")).toBe(1);
    expect(count("<button onClick={retry}><i className=\"ti ti-refresh\" /> Retry</button>", "retry-in-a-raw-button")).toBe(1);
  });

  it("does not count a kit Button, a menu command, or a Retry that sits after the raw button has closed", () => {
    expect(count('<Button variant="ghost" loading={busy} onClick={retry}>Retry</Button>', "retry-in-a-raw-button")).toBe(0);
    expect(count('<Notice role="alert" action={<Button onClick={retry}>Retry</Button>}>{error}</Notice>', "retry-in-a-raw-button")).toBe(0);
    expect(count('<button type="button" role="menuitem" onClick={onRetry}>{label}</button>', "retry-in-a-raw-button")).toBe(0);
    expect(count('<button type="button" onClick={save}>Save</button>\n<Button onClick={retry}>\n  Retry\n</Button>', "retry-in-a-raw-button")).toBe(0);
    expect(count("<button-group>Retry</button-group>", "retry-in-a-raw-button")).toBe(0);
    expect(count("<button />\n<Button onClick={retry}>Retry</Button>", "retry-in-a-raw-button")).toBe(0);
  });

  it("does not look at a command that merely mentions retry, or at comments", () => {
    // A menu item that re-runs a catalog load is a command in a menu, not the failure's own control.
    expect(count('<RetryMenuItem onRetry={retry} label="Retry loading items" />', "retry-outside-an-alert")).toBe(0);
    expect(count("<button role=\"menuitem\" onClick={retry}>\n  Retry loading items\n</button>", "retry-outside-an-alert")).toBe(0);
    expect(count('<Button onClick={retry}>Try again later</Button>', "retry-outside-an-alert")).toBe(0);
    expect(count("// Retry\nconst a = 1;", "retry-outside-an-alert")).toBe(0);
  });

  it("counts every control that offers to run a failed load again, not only one worded exactly Retry", () => {
    // "Retry now" (a live poll that stopped) and "Reload" / "Reload page" (a stale save, a crashed screen).
    expect(count('<Notice variant="warning" as="output">Stopped. <button onClick={retry}>Retry now</button></Notice>', "retry-outside-an-alert")).toBe(1);
    expect(count('<Notice variant="warning" action={<Button onClick={reload}>Reload</Button>}>Stale.</Notice>', "retry-outside-an-alert")).toBe(1);
    expect(count('<div className="panel"><Button onClick={reload}>Reload page</Button></div>', "retry-outside-an-alert")).toBe(1);
    expect(count('<Notice variant="warning" role="alert" action={<Button onClick={reload}>Reload</Button>}>Stale.</Notice>', "retry-outside-an-alert")).toBe(0);
    expect(count('<div className="panel" role="alert"><Button onClick={reload}>Reload page</Button></div>', "retry-outside-an-alert")).toBe(0);
  });

  it("counts a raw <button> that is disabled while busy, whatever the flag is called", () => {
    expect(count("<button type=\"button\" disabled={busy} onClick={go}>Go</button>", "raw-button-busy-disabled")).toBe(1);
    expect(count("<button type=\"button\" disabled={!canSave || isSaving}>Save</button>", "raw-button-busy-disabled")).toBe(1);
    expect(count("<button\n  type=\"button\"\n  disabled={bulkSendBusy}\n>Send</button>", "raw-button-busy-disabled")).toBe(1);
  });

  it("counts a busy flag named after what is happening, in any verb", () => {
    for (const flag of ["markingAll", "clearing", "isExporting", "reordering || !canSave", "!hasItems || isCancelling"]) {
      expect(count(`<button type="button" disabled={${flag}} onClick={go}>Go</button>`, "raw-button-busy-disabled")).toBe(1);
    }
  });

  it("does not take a plain noun that ends in -ing, or a flag that is not work in progress, for a busy flag", () => {
    for (const flag of ["disabled", "isArchived", "bounceActionsLocked", "!hasCoordinates || isArchived", 'typeof value === "string"', "!settingsLoaded || !canConfirm", "!canAct"]) {
      expect(count(`<button type="button" disabled={${flag}} onClick={go}>Go</button>`, "raw-button-busy-disabled")).toBe(0);
    }
  });

  it("does not count a kit Button, a raw <button> disabled for another reason, or one with no disabled", () => {
    expect(count("<Button loading={busy} disabled={busy}>Go</Button>", "raw-button-busy-disabled")).toBe(0);
    expect(count("<button type=\"button\" disabled={!canSave}>Save</button>", "raw-button-busy-disabled")).toBe(0);
    expect(count("<button type=\"button\" onClick={go}>Go</button>", "raw-button-busy-disabled")).toBe(0);
    expect(count("<ButtonGroup disabled={busy} />", "raw-button-busy-disabled")).toBe(0);
  });

  it("does not take aria-disabled for disabled: that is how a busy raw <button> keeps its focus", () => {
    expect(count("<button type=\"button\" aria-disabled={busy || undefined} onClick={go}>Go</button>", "raw-button-busy-disabled")).toBe(0);
    expect(count("<button type=\"button\" aria-busy={saving} aria-disabled={saving} onClick={go}>Go</button>", "raw-button-busy-disabled")).toBe(0);
    // ... while the same tag with a real `disabled` is still one.
    expect(count("<button type=\"button\" aria-disabled={saving} disabled={saving} onClick={go}>Go</button>", "raw-button-busy-disabled")).toBe(1);
  });
});

