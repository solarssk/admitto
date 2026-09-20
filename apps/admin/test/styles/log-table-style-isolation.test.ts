import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ADMIN_SRC = join(dirname(fileURLToPath(import.meta.url)), "../../src");
const auditLogPanel = readFileSync(join(ADMIN_SRC, "settings/AuditLogPanel.tsx"), "utf8");
const staffCss = readFileSync(join(ADMIN_SRC, "staff.css"), "utf8");
const accountPage = readFileSync(join(ADMIN_SRC, "account/AccountPage.tsx"), "utf8");
const accountCss = readFileSync(join(ADMIN_SRC, "account/account-page.css"), "utf8");

describe("log table style isolation", () => {
  it("keeps the compact account-session scroll region separate from Audit and Security logs", () => {
    expect(auditLogPanel).toContain("audit-log-table-wrap");
    expect(auditLogPanel).not.toContain("sessions-table-wrap");
    expect(staffCss).toContain(".audit-log-table-wrap {");
    expect(accountPage).toContain("account-sessions-table-wrap");
    expect(accountCss).toContain(".account-sessions-table-wrap {");
    expect(accountCss).not.toMatch(/(?:^|\n)\.sessions-table-wrap\s*\{/);
  });

  it("uses one dedicated secondary-text treatment for log emails and IP locations", () => {
    expect(auditLogPanel).toContain("audit-log-secondary");
    expect(staffCss).toContain(".audit-log-secondary {");
    expect(staffCss).toMatch(/\.audit-log-time__local\s*\{[\s\S]*font-size: var\(--fs-xs\);/);
  });
});
