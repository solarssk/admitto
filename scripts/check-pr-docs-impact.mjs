import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const eventPath = process.env.GITHUB_EVENT_PATH;
if (!eventPath) {
  console.log("docs:pr-check: no pull-request event; skipping declaration check.");
  process.exit(0);
}

const event = JSON.parse(readFileSync(eventPath, "utf8"));
if (!event.pull_request) {
  console.log("docs:pr-check: not a pull-request event; skipping declaration check.");
  process.exit(0);
}

const body = event.pull_request.body ?? "";
const wikiUpdated = /^- \[[xX]\] Wiki updated\s*$/m.test(body);
const noWikiUpdate = /^- \[[xX]\] No Wiki update needed — \S.+$/m.test(body);

if (wikiUpdated === noWikiUpdate) {
  console.error("docs:pr-check: select exactly one Documentation impact declaration.");
  process.exit(1);
}

const changedFiles = execFileSync(
  "git",
  ["diff", "--name-only", `${event.pull_request.base.sha}...${event.pull_request.head.sha}`],
  { encoding: "utf8" },
).split("\n").filter(Boolean);
const wikiChanged = changedFiles.some((file) => file.startsWith("docs/wiki/"));

if (wikiUpdated && !wikiChanged) {
  console.error("docs:pr-check: 'Wiki updated' is selected but docs/wiki has no change.");
  process.exit(1);
}
if (noWikiUpdate && wikiChanged) {
  console.error("docs:pr-check: Wiki source changed; select 'Wiki updated' instead.");
  process.exit(1);
}

console.log("docs:pr-check: Documentation impact declaration is consistent with the diff.");
