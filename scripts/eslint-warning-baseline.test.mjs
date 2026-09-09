import { test } from "node:test";
import assert from "node:assert/strict";
import { diffFingerprints, fingerprintKey, sortFingerprints } from "./eslint-warning-baseline.mjs";

function fp(overrides = {}) {
  return {
    ruleId: "security/detect-object-injection",
    filePath: "packages/tickets/src/attendees-export-pdf.ts",
    message: "Generic Object Injection Sink",
    codeLine: "value[key]",
    contextBefore: "",
    contextAfter: "",
    ...overrides,
  };
}

test("diffFingerprints: identical baseline and current has no new warnings", () => {
  const baseline = [fp()];
  const current = [fp()];
  assert.deepEqual(diffFingerprints(baseline, current), []);
});

test("diffFingerprints: a genuinely new fingerprint is flagged", () => {
  const baseline = [fp()];
  const current = [fp(), fp({ ruleId: "no-console", message: "Unexpected console statement." })];
  const newWarnings = diffFingerprints(baseline, current);
  assert.equal(newWarnings.length, 1);
  assert.equal(newWarnings[0].ruleId, "no-console");
});

test("diffFingerprints: fixing an existing warning (shrinking the set) is never flagged", () => {
  const baseline = [fp(), fp({ codeLine: "other[key]" })];
  const current = [fp()];
  assert.deepEqual(diffFingerprints(baseline, current), []);
});

test("diffFingerprints: a third occurrence of a signature the baseline only saw twice is caught", () => {
  const baseline = [fp(), fp()];
  const current = [fp(), fp(), fp()];
  const newWarnings = diffFingerprints(baseline, current);
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
  const newWarnings = diffFingerprints(baseline, current);
  assert.equal(newWarnings.length, 1, "the swapped-in occurrence must be reported as new");
  assert.equal(fingerprintKey(newWarnings[0]), fingerprintKey(current[0]));
});

test("diffFingerprints: the same swap with unchanged context is correctly treated as unchanged", () => {
  const baseline = [fp({ contextBefore: "a", contextAfter: "b" })];
  const current = [fp({ contextBefore: "a", contextAfter: "b" })];
  assert.deepEqual(diffFingerprints(baseline, current), []);
});

test("sortFingerprints: deterministic order across filePath, ruleId, message, codeLine, context", () => {
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
