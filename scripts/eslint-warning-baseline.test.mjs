import { test } from "node:test";
import assert from "node:assert/strict";
import { diffFingerprints, fingerprintKey, sortFingerprints } from "./eslint-warning-baseline.mjs";

function fp(overrides = {}) {
  return {
    ruleId: "security/detect-object-injection",
    filePath: "packages/tickets/src/attendees-export-pdf.ts",
    message: "Generic Object Injection Sink",
    codeLine: "value[key]",
    column: 1,
    contextBefore: "",
    contextAfter: "",
    ...overrides,
  };
}

test("diffFingerprints: identical baseline and current has no new or stale warnings", () => {
  const baseline = [fp()];
  const current = [fp()];
  assert.deepEqual(diffFingerprints(baseline, current), { newWarnings: [], staleWarnings: [] });
});

test("diffFingerprints: a genuinely new fingerprint is flagged", () => {
  const baseline = [fp()];
  const current = [fp(), fp({ ruleId: "no-console", message: "Unexpected console statement." })];
  const { newWarnings, staleWarnings } = diffFingerprints(baseline, current);
  assert.equal(newWarnings.length, 1);
  assert.equal(newWarnings[0].ruleId, "no-console");
  assert.deepEqual(staleWarnings, []);
});

test("diffFingerprints: fixing an existing warning without refreshing the baseline is flagged as stale", () => {
  const baseline = [fp(), fp({ codeLine: "other[key]" })];
  const current = [fp()];
  const { newWarnings, staleWarnings } = diffFingerprints(baseline, current);
  assert.deepEqual(newWarnings, []);
  assert.equal(staleWarnings.length, 1);
  assert.equal(staleWarnings[0].codeLine, "other[key]");
});

// The exact gap the P2 review on PR #1290 flagged: check() used to only look for new warnings, so
// a baseline entry left over after its warning was fixed (never regenerated) would sit there
// unconsumed. A LATER, unrelated PR could then reintroduce that exact warning at the same source
// context and have it silently match the stale entry - nothing distinguished "still present" from
// "removed and never cleaned up" before staleWarnings existed.
test("diffFingerprints: a stale entry would otherwise let a reintroduced warning pass unnoticed", () => {
  const stillPresent = fp();
  const nowFixed = fp({ codeLine: "other[key]" });
  const baseline = [stillPresent, nowFixed];
  // First PR: fixes `nowFixed`, doesn't refresh the baseline.
  const afterFix = diffFingerprints(baseline, [stillPresent]);
  assert.equal(afterFix.staleWarnings.length, 1, "the fix must be caught as a stale baseline entry");
  // If that stale entry had been left in the baseline (i.e. the gate didn't fail on it), a later
  // PR reintroducing the exact same warning would match it and report nothing new.
  const reintroduced = diffFingerprints(baseline, [stillPresent, nowFixed]);
  assert.deepEqual(reintroduced.newWarnings, [], "demonstrates the reintroduction is otherwise silent");
});

test("diffFingerprints: a third occurrence of a signature the baseline only saw twice is caught", () => {
  const baseline = [fp(), fp()];
  const current = [fp(), fp(), fp()];
  const { newWarnings } = diffFingerprints(baseline, current);
  assert.equal(newWarnings.length, 1);
});

// The exact swap the P2 review on PR #1290 flagged: same {ruleId, filePath, message, codeLine} at
// two different call sites in one file (a real, not hypothetical, case here - see the module doc
// comment on packages/tickets/src/attendees-export-pdf.ts). One occurrence is "fixed" (removed);
// a DIFFERENT, previously-unseen occurrence with the identical rule/message/codeLine appears
// elsewhere in the same file. Before contextBefore/contextAfter existed, this fingerprint was
// {ruleId, filePath, message, codeLine} alone, so the multiset saw "1 before, 1 after" for that
// exact key and reported nothing new - even though the surviving occurrence is a genuinely
// different, never-reviewed warning. contextBefore/contextAfter must tell them apart.
test("diffFingerprints: catches a same-codeLine warning swapped to a different call site in the same file", () => {
  const baseline = [
    fp({ contextBefore: "const row = rows[i];", contextAfter: "return value.trim();" }),
  ];
  const current = [
    fp({ contextBefore: "const entry = header.fields[j];", contextAfter: "columns.push(value);" }),
  ];
  const { newWarnings } = diffFingerprints(baseline, current);
  assert.equal(newWarnings.length, 1, "the swapped-in occurrence must be reported as new");
  assert.equal(fingerprintKey(newWarnings[0]), fingerprintKey(current[0]));
});

test("diffFingerprints: the same swap with unchanged context is correctly treated as unchanged", () => {
  const baseline = [fp({ contextBefore: "a", contextAfter: "b" })];
  const current = [fp({ contextBefore: "a", contextAfter: "b" })];
  assert.deepEqual(diffFingerprints(baseline, current), { newWarnings: [], staleWarnings: [] });
});

// A second P2 review round flagged that context alone still collides for a real case in this repo:
// packages/tickets/src/attendees-export-pdf.ts has single lines with TWO separate object-injection
// expressions (e.g. `doc.text(cells[i] ?? "", ..., cellOptions(plan.contentWidths[i]!, ...))` flags
// both `cells[i]` and `plan.contentWidths[i]`) - identical rule, message, codeLine, AND context,
// since both live on the same line. ESLint reports these as two messages sharing one `line` but
// different `column`s. Swapping which of the two survives (fix the one at column 16, introduce a
// different column-53 issue on an unrelated line elsewhere) must be caught.
test("diffFingerprints: catches a same-line, same-codeLine warning swapped to a different column", () => {
  const baseline = [fp({ column: 16 })];
  const current = [fp({ column: 53 })];
  const { newWarnings } = diffFingerprints(baseline, current);
  assert.equal(newWarnings.length, 1, "a different column on the same codeLine is a different warning");
});

test("sortFingerprints: deterministic order across filePath, ruleId, message, codeLine, column, context", () => {
  const a = fp({ filePath: "a.ts" });
  const b = fp({ filePath: "b.ts" });
  const sorted = sortFingerprints([b, a]);
  assert.deepEqual(sorted, [a, b]);
});

test("fingerprintKey: two fingerprints differing only in contextBefore produce different keys", () => {
  const a = fp({ contextBefore: "x" });
  const b = fp({ contextBefore: "y" });
  assert.notEqual(fingerprintKey(a), fingerprintKey(b));
});

test("fingerprintKey: two fingerprints differing only in column produce different keys", () => {
  const a = fp({ column: 16 });
  const b = fp({ column: 53 });
  assert.notEqual(fingerprintKey(a), fingerprintKey(b));
});
