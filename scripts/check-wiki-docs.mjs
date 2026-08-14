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
  "Ticket-Types.md",
  "Custom-Attendee-Fields.md",
  "Requirements-and-Fulfilment.md",
  "Event-Items-and-Check-in-Behaviour.md",
  "QR-Tickets.md",
  "Pass-Statuses.md",
  "Email-Templates.md",
  "Advanced-Email-Templates.md",
  "Template-Variables.md",
  "Sending-Tickets-and-Delivery.md",
  "Email-Delivery-Statuses.md",
  "Operator-Quick-Start.md",
  "Scanning-Tickets-and-Results.md",
  "Manual-Lookup-and-Corrections.md",
  "Check-in-Connection-Problems.md",
  "Reports-and-Archiving.md",
  "Organisation-Administration.md",
  "Users-and-Roles-Administration.md",
  "Superadmin-Quick-Start.md",
  "Organisation-Settings.md",
  "Mail-Delivery-Administration.md",
  "Identity-and-SSO.md",
  "Logs-and-Audit.md",
  "Import-File-Reference.md",
  "Glossary.md",
  "Help-and-Troubleshooting.md",
  "Technical-Documentation.md",
  "Reference-and-Troubleshooting.md",
  "_Sidebar.md",
];
const metadataLabels = ["Audience", "Required role", "Feature status", "Last verified"];
const validStatuses = new Set(["Available", "Preview", "Planned", "Deprecated"]);
const requiredSidebarSections = [
  "Start Here",
  "Event Management",
  "Registration and Attendees",
  "Requirements and Fulfilment",
  "Tickets and Passes",
  "Communication",
  "Check-in Operations",
  "Organisation Administration",
  "System Administration",
  "Integrations",
  "Reference",
  "Help",
  "Technical Documentation",
];
const workflowPages = new Set([
  "Create-an-Event.md",
  "Event-Overview-and-Settings.md",
  "Managing-Attendees.md",
  "Importing-Attendees.md",
  "Ticket-Types.md",
  "Custom-Attendee-Fields.md",
  "Event-Items-and-Check-in-Behaviour.md",
  "QR-Tickets.md",
  "Email-Templates.md",
  "Advanced-Email-Templates.md",
  "Sending-Tickets-and-Delivery.md",
  "Operator-Quick-Start.md",
  "Scanning-Tickets-and-Results.md",
  "Manual-Lookup-and-Corrections.md",
  "Check-in-Connection-Problems.md",
  "Reports-and-Archiving.md",
  "Organisation-Administration.md",
  "Users-and-Roles-Administration.md",
  "Superadmin-Quick-Start.md",
  "Organisation-Settings.md",
  "Mail-Delivery-Administration.md",
  "Identity-and-SSO.md",
  "Logs-and-Audit.md",
]);
const workflowHeadings = [
  "What this page helps you do",
  "Before you start",
  "Steps",
  "Expected result",
  "Important decisions",
  "What changes after this action",
  "Common problems",
  "Related pages",
];

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

function* markdownLinks(text) {
  let searchFrom = 0;
  while (searchFrom < text.length) {
    const labelStart = text.indexOf("[", searchFrom);
    if (labelStart === -1) return;

    const labelEnd = text.indexOf("]", labelStart + 1);
    const targetStart = labelEnd === -1 ? -1 : labelEnd + 1;
    if (targetStart === -1 || text[targetStart] !== "(") {
      searchFrom = labelStart + 1;
      continue;
    }

    const targetEnd = text.indexOf(")", targetStart + 1);
    if (targetEnd === -1) return;

    const contents = text.slice(targetStart + 1, targetEnd);
    const separator = [...contents].findIndex((character) => character.trim().length === 0);
    const target = separator === -1 ? contents : contents.slice(0, separator);
    yield {
      target,
      isImage: labelStart > 0 && text[labelStart - 1] === "!",
      alternativeText: text.slice(labelStart + 1, labelEnd),
    };
    searchFrom = targetEnd + 1;
  }
}

function isEmailCharacter(character) {
  return (character >= "a" && character <= "z")
    || (character >= "A" && character <= "Z")
    || (character >= "0" && character <= "9")
    || "._%+-".includes(character);
}

function emailDomains(text) {
  const domains = [];
  for (let atIndex = text.indexOf("@"); atIndex !== -1; atIndex = text.indexOf("@", atIndex + 1)) {
    let localStart = atIndex;
    while (localStart > 0 && isEmailCharacter(text[localStart - 1])) localStart -= 1;
    let domainEnd = atIndex + 1;
    while (domainEnd < text.length && isEmailCharacter(text[domainEnd])) domainEnd += 1;

    const localPart = text.slice(localStart, atIndex);
    const domain = text.slice(atIndex + 1, domainEnd);
    const topLevelDomain = domain.slice(domain.lastIndexOf(".") + 1);
    if (localPart && domain.includes(".") && topLevelDomain.length >= 2) domains.push(domain);
  }
  return domains;
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
    const fileName = relative(wikiRoot, filePath);
    if (filePath !== resolve(wikiRoot, "_Sidebar.md")) {
      if (!text.startsWith("# ")) fail(`${relativePath} is missing its page title.`);
      for (const label of metadataLabels) {
        if (!text.includes(`| **${label}** |`)) fail(`${relativePath} is missing ${label} metadata.`);
      }
      const status = text.match(/^\| \*\*Feature status\*\* \| (.+) \|$/m)?.[1]?.trim();
      if (!status || !validStatuses.has(status)) {
        fail(`${relativePath} has an invalid feature status.`);
      }
      if (workflowPages.has(fileName)) {
        for (const heading of workflowHeadings) {
          if (!text.includes(`## ${heading}`)) fail(`${relativePath} is missing the ${heading} section.`);
        }
      }
    }

    for (const { target, isImage, alternativeText } of markdownLinks(text)) {
      const localTarget = localTargetForLink(target, isImage);
      if (isImage && !alternativeText) fail(`${relativePath} has an image without alternative text.`);
      if (!localTarget) continue;
      if (!localTarget.startsWith(wikiRoot)) {
        fail(`${relativePath} links outside docs/wiki: ${target}`);
      } else if (!existsSync(localTarget)) {
        fail(`${relativePath} links to missing file: ${target}`);
      }
    }

    for (const emailDomain of emailDomains(text)) {
      const domain = emailDomain.toLowerCase();
      if (!domain.startsWith("example.")) {
        fail(`${relativePath} contains a non-synthetic email address.`);
      }
    }
  }

  const sidebar = readFileSync(resolve(wikiRoot, "_Sidebar.md"), "utf8");
  for (const section of requiredSidebarSections) {
    if (!sidebar.includes(`**${section}**`)) fail(`_Sidebar.md is missing the ${section} section.`);
  }
  for (const page of requiredPages.filter((page) => page !== "_Sidebar.md")) {
    const slug = page.slice(0, -3);
    if (!sidebar.includes(`](${slug})`)) fail(`_Sidebar.md does not link to ${slug}.`);
  }
}

if (!process.exitCode) console.log("docs:check: Wiki source is valid.");
