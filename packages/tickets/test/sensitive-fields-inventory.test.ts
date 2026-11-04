/**
 * Guard for sensitive attendee fields (D-E6): every source file that reads or writes `custom_data` has a decision recorded
 * here, so a new reader fails this test until someone decides whether it needs the rule. The rule itself is in
 * `src/sensitive-custom-data.ts`; the behaviour of each surface is tested next to it; the reasoning is in
 * DATA-PROTECTION.md ("Sensitive attendee fields").
 *
 * What the decisions mean:
 * - redacted: the file keeps the answers to sensitive questions out of what it returns or writes. `via` is a text that must
 *             stay in the file, so the entry cannot outlive the code that makes it true.
 * - n/a:      the file never shows a stored answer to anyone who did not give it: the form a guest fills in, the code that
 *             only stores or validates, a type, an error text. `why` says which.
 * - later:    a surface that a later pull request of the same feature closes (117b, 117c or 117d); it stays listed until it does.
 *
 * A file may be `redacted` or `n/a` and also carry a `pending` surface of a later pull request.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

type Pending = { pr: "117b" | "117c" | "117d"; what: string };
type Decision =
  | { decision: "redacted"; via: string; pending?: Pending }
  | { decision: "n/a"; why: string; pending?: Pending }
  | { decision: "later"; pending: Pending };

const READS_ONLY_NAMES = "Reads the answers by the names of the fields the server sends and renders what it is given; the server leaves sensitive answers out.";
const GUEST_FORM = "The registration form a guest fills in: it asks the question, and nothing there shows a stored answer.";
const STORES_ONLY = "Stores or validates an answer; nothing in it returns a stored answer to a reader.";

const INVENTORY: Record<string, Decision> = {
  // The admin SPA: it shows what the API sends. The server removes the answers, so these files need no rule of their own.
  "apps/admin/src/api/client.ts": { decision: "n/a", why: "Transport and types of the admin API; carries whatever the server sends." },
  "apps/admin/src/api/operator-api-error.ts": { decision: "n/a", why: "Error texts keyed by code; no answer is in an error." },
  "apps/admin/src/api/types.ts": { decision: "n/a", why: "Types of the admin API; no code that reads an answer." },
  "apps/admin/src/attendees/AddAttendeeModal.tsx": { decision: "later", pending: { pr: "117c", what: "the box of a sensitive question says it is write-only" } },
  "apps/admin/src/attendees/CompanionCard.tsx": { decision: "later", pending: { pr: "117c", what: "mask and Show for the companion's sensitive answers" } },
  "apps/admin/src/attendees/CustomDataFieldInput.tsx": { decision: "later", pending: { pr: "117c", what: "the write-only box of a sensitive question" } },
  "apps/admin/src/attendees/attendeeDetailForm.ts": { decision: "later", pending: { pr: "117c", what: "an empty sensitive box means unchanged" } },
  "apps/admin/src/attendees/attendeeTimeline.ts": { decision: "n/a", why: "Names the fields an edit changed (their keys), never their values." },
  "apps/admin/src/attendees/companionForm.ts": { decision: "later", pending: { pr: "117c", what: "the write-only box of a sensitive companion question" } },
  "apps/admin/src/attendees/customData.ts": { decision: "later", pending: { pr: "117c", what: "mask in the details view; a required sensitive question is not blocked when its box is empty" } },
  "apps/admin/src/attendees/erasedAttendee.ts": { decision: "n/a", why: "Placeholder for an erased attendee; holds no answer." },
  "apps/admin/src/attendees/useCompanionActions.ts": { decision: "n/a", why: "Sends the companion form; shows no stored answer." },
  "apps/admin/src/pages/AttendeeDetailPage.tsx": { decision: "later", pending: { pr: "117c", what: "mask and Show on the attendee page" } },
  "apps/admin/src/pages/AttendeesPage.tsx": { decision: "redacted", via: "field.sensitive !== true" },
  "apps/admin/src/pages/ImportPage.tsx": { decision: "n/a", why: "Shows the preview of the server, whose sample rows leave a sensitive cell empty." },
  "apps/admin/src/registration/RequestDetailDialog.tsx": { decision: "later", pending: { pr: "117c", what: "mask and Show in the request window" } },
  "apps/admin/src/registration/useRequestLookups.ts": { decision: "n/a", why: READS_ONLY_NAMES },

  // The server.
  "apps/web/src/admin/admin-helpers.ts": {
    decision: "n/a",
    why: "Counts the answers of one field for the callers that ask; reports-routes.ts and event-custom-fields-routes.ts never ask for a sensitive field.",
  },
  "apps/web/src/admin/attendee-companion-routes.ts": {
    decision: "n/a",
    why: "Takes the answers in (write-only for staff, writeAttendeeCompanion) and answers with the attendee page, which attendees-api-routes.ts redacts.",
  },
  "apps/web/src/admin/attendees-api-routes.ts": { decision: "redacted", via: "redactSensitiveCustomData(" },
  "apps/web/src/admin/checkin-api-routes.ts": { decision: "n/a", why: "Reads only the company and department keys for the history of scans." },
  "apps/web/src/admin/event-custom-fields-routes.ts": { decision: "redacted", via: "existing.sensitive" },
  "apps/web/src/admin/event-settings-routes.ts": {
    decision: "redacted",
    via: "redactSensitiveCustomData(",
    pending: { pr: "117d", what: "the wallet field mapping refuses a sensitive field" },
  },
  "apps/web/src/admin/import-api-routes.ts": { decision: "redacted", via: "field.sensitive" },
  "apps/web/src/admin/registrations-api-routes.ts": { decision: "redacted", via: "redactSensitiveCustomData(" },
  "apps/web/src/admin/reports-routes.ts": { decision: "redacted", via: "sensitive: false" },
  "apps/web/src/app.ts": { decision: "later", pending: { pr: "117d", what: "the wallet pass built for an attendee leaves a sensitive field out" } },
  "apps/web/src/registration/form-contract.ts": { decision: "n/a", why: GUEST_FORM },
  "apps/web/src/registration/form-fields.ts": { decision: "n/a", why: GUEST_FORM },
  "apps/web/src/registration/form-model.ts": { decision: "n/a", why: GUEST_FORM },
  "apps/web/src/registration/form-script.ts": { decision: "n/a", why: GUEST_FORM },
  "apps/web/src/registration/submit-body.ts": { decision: "n/a", why: GUEST_FORM },

  // The packages.
  "packages/db/src/status.ts": { decision: "n/a", why: "A comment about where companion answers live." },
  "packages/import/src/custom-data-import.ts": {
    decision: "n/a",
    why: "Its refusal reasons name the field (its label) and never the value of a cell.",
  },
  "packages/import/src/importer.ts": { decision: "n/a", why: STORES_ONLY },
  "packages/import/src/parser.ts": { decision: "n/a", why: "Reads the cells of a file; its invalid-row reasons carry no cell." },
  "packages/import/src/types.ts": { decision: "n/a", why: "Types; ImportAttributeField carries the sensitive flag to the preview." },
  "packages/tickets/src/attendee-card.ts": { decision: "later", pending: { pr: "117d", what: "the operator card (content_fields) leaves a sensitive field out" } },
  "packages/tickets/src/attendee-companion.ts": { decision: "redacted", via: "sensitiveAnswersLeftAsStored" },
  "packages/tickets/src/attendees-export.ts": { decision: "redacted", via: "withoutSensitiveFields(" },
  "packages/tickets/src/attendees-list-filters.ts": {
    decision: "n/a",
    why: "Searches the company and department keys only; a filter on another key comes from the registry, which the route reads without sensitive fields.",
  },
  "packages/tickets/src/checkin.ts": { decision: "n/a", why: "Selects the column for the company and department of the history of scans." },
  "packages/tickets/src/custom-data-reserved.ts": { decision: "n/a", why: "Names of fixed columns that a field may not use." },
  "packages/tickets/src/custom-data.ts": { decision: "n/a", why: "Reads one key of a value it is given." },
  "packages/tickets/src/erase-attendees.ts": { decision: "n/a", why: "The erasure: it clears the answers of the attendee, the companion and the registration." },
  "packages/tickets/src/event-custom-fields.ts": { decision: "redacted", via: "row.sensitive" },
  "packages/tickets/src/event-item-contents.ts": { decision: "later", pending: { pr: "117d", what: "buildItemDetail leaves a sensitive field out of the card" } },
  "packages/tickets/src/index.ts": { decision: "n/a", why: "Re-exports of the package; no code of its own." },
  "packages/tickets/src/registrant-input.ts": { decision: "n/a", why: "The boundary of what a registrant sends; it reads input and returns the cleaned answers to the writer." },
  "packages/tickets/src/registration-attendee.ts": { decision: "n/a", why: STORES_ONLY },
  "packages/tickets/src/registration-list.ts": { decision: "n/a", why: "The list leaves the answers out and the search never reads them." },
  "packages/tickets/src/registration-lock.ts": { decision: "n/a", why: "Reads the locked row for the writers of a decision; nothing it reads is returned to a reader." },
  "packages/tickets/src/registration-placement.ts": { decision: "n/a", why: STORES_ONLY },
  "packages/tickets/src/reissue-wallet-pass.ts": { decision: "later", pending: { pr: "117d", what: "the pass built again leaves a sensitive field out" } },
  "packages/tickets/src/resolve.ts": { decision: "later", pending: { pr: "117d", what: "the resolved ticket carries the answers to the wallet builder, which leaves sensitive fields out" } },
  "packages/tickets/src/sensitive-custom-data.ts": { decision: "redacted", via: "export function redactSensitiveCustomData" },
  "packages/tickets/src/types.ts": { decision: "n/a", why: "Types of the package; no code that reads an answer." },
  "packages/tickets/src/validate-custom-data.ts": { decision: "n/a", why: "Its errors carry the key of a field and never a value." },
  "packages/tickets/src/wallet-custom-fields.ts": { decision: "later", pending: { pr: "117d", what: "the pass placeholders skip a sensitive field" } },
};

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const SOURCE_ROOTS = ["apps/web/src", "apps/admin/src", "apps/cli/src", "packages"];
const SKIPPED_DIRS = new Set(["node_modules", "dist", "generated", "test", "tests", "__tests__"]);
const READS_ANSWERS = /custom_data|customData/;

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (!SKIPPED_DIRS.has(entry)) found.push(...sourceFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry) && !entry.endsWith(".d.ts")) {
      found.push(full);
    }
  }
  return found;
}

const readingFiles = SOURCE_ROOTS.map((root) => path.join(ROOT, root))
  .filter((dir) => existsSync(dir))
  .flatMap(sourceFiles)
  .filter((file) => READS_ANSWERS.test(readFileSync(file, "utf8")))
  .map((file) => path.relative(ROOT, file).split(path.sep).join("/"))
  .sort();

describe("sensitive attendee fields inventory", () => {
  it("has a decision for every source file that touches custom_data", () => {
    const undecided = readingFiles.filter((file) => !(file in INVENTORY));
    expect(
      undecided,
      "A file reads custom_data and has no decision: keep the answers to sensitive questions out of what it returns (redactSensitiveCustomData, withoutSensitiveFields) or record why it needs neither.",
    ).toEqual([]);
  });

  it("lists no file that is gone or no longer touches custom_data", () => {
    expect(Object.keys(INVENTORY).filter((file) => !readingFiles.includes(file))).toEqual([]);
  });

  it.each(Object.entries(INVENTORY).filter(([, entry]) => entry.decision === "redacted"))(
    "%s: the code that redacts is still there",
    (file, entry) => {
      if (entry.decision !== "redacted") throw new Error("filtered above");
      expect(readFileSync(path.join(ROOT, file), "utf8")).toContain(entry.via);
    },
  );

  it("gives a reason for every n/a", () => {
    const thin = Object.entries(INVENTORY).filter(([, entry]) => entry.decision === "n/a" && entry.why.trim().length < 20);
    expect(thin.map(([file]) => file)).toEqual([]);
  });

  it("names what a later pull request closes, for each surface that is still open", () => {
    const open = Object.entries(INVENTORY)
      .filter(([, entry]) => entry.pending !== undefined)
      .map(([file, entry]) => `${entry.pending!.pr} ${file}`)
      .sort();
    // 117d (wallet, operator card, items, mail) and 117c (the admin screens) remove their lines from this list.
    expect(open).toEqual([
      "117c apps/admin/src/attendees/AddAttendeeModal.tsx",
      "117c apps/admin/src/attendees/CompanionCard.tsx",
      "117c apps/admin/src/attendees/CustomDataFieldInput.tsx",
      "117c apps/admin/src/attendees/attendeeDetailForm.ts",
      "117c apps/admin/src/attendees/companionForm.ts",
      "117c apps/admin/src/attendees/customData.ts",
      "117c apps/admin/src/pages/AttendeeDetailPage.tsx",
      "117c apps/admin/src/registration/RequestDetailDialog.tsx",
      "117d apps/web/src/admin/event-settings-routes.ts",
      "117d apps/web/src/app.ts",
      "117d packages/tickets/src/attendee-card.ts",
      "117d packages/tickets/src/event-item-contents.ts",
      "117d packages/tickets/src/reissue-wallet-pass.ts",
      "117d packages/tickets/src/resolve.ts",
      "117d packages/tickets/src/wallet-custom-fields.ts",
    ]);
  });
});
