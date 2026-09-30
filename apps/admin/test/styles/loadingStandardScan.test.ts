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

describe("loading-standard scanner: forms the standard itself allows", () => {
  it("does not count loading text that is an aria-label (text for assistive tech)", () => {
    expect(code('<output aria-label="Loading…"></output>')["bare-loading-text"]).toBe(0);
    expect(code("<output aria-label={'Loading events…'}></output>")["bare-loading-text"]).toBe(0);
  });

  it("does not count the verb choice inside a Button's loadingLabel", () => {
    const source = '<Button loading={busy} loadingLabel={isCreate ? "Creating…" : "Saving…"}>{isCreate ? "Create" : "Save"}</Button>';
    expect(code(source)["busy-label-swap"]).toBe(0);
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
