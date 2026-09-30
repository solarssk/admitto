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
