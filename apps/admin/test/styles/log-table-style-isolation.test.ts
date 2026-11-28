import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ADMIN_SRC = join(dirname(fileURLToPath(import.meta.url)), "../../src");
const auditLogPanel = readFileSync(join(ADMIN_SRC, "settings/AuditLogPanel.tsx"), "utf8");
const staffCss = readFileSync(join(ADMIN_SRC, "staff.css"), "utf8");
const accountPage = readFileSync(join(ADMIN_SRC, "account/AccountPage.tsx"), "utf8");
const accountCss = readFileSync(join(ADMIN_SRC, "account/account-page.css"), "utf8");
const timeStackCss = readFileSync(join(ADMIN_SRC, "components/time-stack.css"), "utf8");

describe("log table style isolation", () => {
  it("keeps Audit and Security logs and the Account sessions in the shared boxed table, with no scroll region of their own", () => {
    // The logs are the shared boxed table too (audit-log-table.css): their old edge to edge wrapper is gone, and with it a rule to isolate.
    expect(auditLogPanel).toContain("item-table audit-log-box");
    expect(auditLogPanel).not.toContain("audit-log-table-wrap");
    expect(auditLogPanel).not.toContain("sessions-table-wrap");
    expect(staffCss).not.toContain(".audit-log-table-wrap");
    expect(accountPage).toContain("item-table account-sessions-table");
    expect(accountPage).not.toContain("account-sessions-table-wrap");
    expect(accountCss).not.toContain("account-sessions-table-wrap");
    expect(accountCss).not.toMatch(/(?:^|\n)\.sessions-table-wrap\s*\{/);
  });

  it("uses one dedicated secondary-text treatment for log emails and IP locations", () => {
    expect(auditLogPanel).toContain("audit-log-secondary");
    expect(staffCss).toContain(".audit-log-secondary {");
    // The local time line under a log time is the shared one (components/time-stack.css), the same size as those sublines.
    expect(timeStackCss).toMatch(/\.time-stack__local\s*\{[\s\S]*font-size: var\(--fs-xs\);/);
  });
});
