import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, relative } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "..");
const wikiRoot = resolve(repositoryRoot, "docs/wiki");
const requiredPages = [
  "Home.md",
  "About-Admitto.md",
  "Roles-and-Permissions.md",
  "First-Event-Checklist.md",
  "Create-an-Event.md",
  "Event-Overview-and-Settings.md",
  "Managing-Attendees.md",
  "Importing-Attendees.md",
  "Ticket-Types-and-Requirements.md",
  "Email-Templates.md",
  "Sending-Tickets-and-Delivery.md",
  "Operator-Quick-Start.md",
  "Reports-and-Archiving.md",
  "Superadmin-Quick-Start.md",
  "Reference-and-Troubleshooting.md",
  "_Sidebar.md",
];
const metadataLabels = ["Audience", "Required role", "Feature status", "Last verified"];
const validStatuses = new Set(["Available", "Preview", "Planned", "Deprecated"]);
const markdownLink = /!?\[[^\]]*\]\(([^)\s]+)(?:\s+[^)]*)?\)/g;
const emailAddress = /[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;

function fail(message) {
  console.error(`docs:check: ${message}`);
  process.exitCode = 1;
}

function allFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = resolve(directory, entry.name);
    return entry.isDirectory() ? allFiles(entryPath) : [entryPath];
  });
}

function localTargetForLink(target, isImage) {
  const withoutAnchor = target.split("#", 1)[0];
  if (!withoutAnchor || /^(?:https?:|mailto:|tel:|data:)/i.test(withoutAnchor)) return null;
  return resolve(wikiRoot, isImage || withoutAnchor.endsWith(".md") ? withoutAnchor : `${withoutAnchor}.md`);
}

if (!existsSync(wikiRoot) || !statSync(wikiRoot).isDirectory()) {
  fail("docs/wiki is missing.");
} else {
  const files = allFiles(wikiRoot);
  for (const page of requiredPages) {
    if (!existsSync(resolve(wikiRoot, page))) fail(`required page ${page} is missing.`);
  }

  for (const filePath of files.filter((path) => path.endsWith(".md"))) {
    const text = readFileSync(filePath, "utf8");
    const relativePath = relative(repositoryRoot, filePath);
    if (filePath !== resolve(wikiRoot, "_Sidebar.md")) {
      if (!text.startsWith("# ")) fail(`${relativePath} is missing its page title.`);
      for (const label of metadataLabels) {
        if (!text.includes(`> **${label}:**`)) fail(`${relativePath} is missing ${label} metadata.`);
      }
      const status = text.match(/^> \*\*Feature status:\*\* (.+)$/m)?.[1]?.trim();
      if (!status || !validStatuses.has(status)) {
        fail(`${relativePath} has an invalid feature status.`);
      }
    }

    for (const match of text.matchAll(markdownLink)) {
      const target = match[1];
      const localTarget = localTargetForLink(target, match[0].startsWith("!"));
      if (match[0].startsWith("![]")) fail(`${relativePath} has an image without alternative text.`);
      if (!localTarget) continue;
      if (!localTarget.startsWith(wikiRoot)) {
        fail(`${relativePath} links outside docs/wiki: ${target}`);
      } else if (!existsSync(localTarget)) {
        fail(`${relativePath} links to missing file: ${target}`);
      }
    }

    for (const match of text.matchAll(emailAddress)) {
      const domain = match[1].toLowerCase();
      if (!domain.startsWith("example.")) {
        fail(`${relativePath} contains a non-synthetic email address.`);
      }
    }
  }

  const sidebar = readFileSync(resolve(wikiRoot, "_Sidebar.md"), "utf8");
  for (const page of requiredPages.filter((page) => page !== "_Sidebar.md")) {
    const slug = page.slice(0, -3);
    if (!sidebar.includes(`](${slug})`)) fail(`_Sidebar.md does not link to ${slug}.`);
  }
}

if (!process.exitCode) console.log("docs:check: Wiki source is valid.");
