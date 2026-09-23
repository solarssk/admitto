import { appendFileSync, writeFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { test, expect, type Page, type TestInfo } from "@playwright/test";
import { readSeedData } from "./seed.js";

/**
 * Accessibility scan (axe-core) over the surfaces this suite can already reach with its one seeded
 * operator account. Report-only: violations are logged, saved as JSON under test-results/, and written to
 * the job summary, but never fail the run - a blocking gate is a follow-up once a clean baseline
 * exists. Only failing to scan at all (nothing evaluated) fails a test.
 */

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

async function scanAndReport(
  page: Page,
  testInfo: TestInfo,
  surface: string,
): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();

  // Guards against a silently empty scan (e.g. the page hadn't rendered) counting as "no violations".
  expect(results.passes.length + results.violations.length).toBeGreaterThan(0);

  const blocking = results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
  const lines = results.violations.map(
    (v) =>
      `- [${v.impact ?? "unknown"}] ${v.id}: ${v.help} (${v.nodes.length} node${v.nodes.length === 1 ? "" : "s"})`,
  );

  // Written under test-results/ (uploaded by the workflow) rather than testInfo.attach: attachments
  // only reach disk through an HTML/JSON reporter, which this suite's list reporter isn't.
  writeFileSync(
    testInfo.outputPath(`axe-${surface}.json`),
    JSON.stringify(results.violations, null, 2),
  );

  console.log(
    `[a11y] ${surface}: ${results.violations.length} violation(s), ${blocking.length} serious/critical`,
  );

  const summaryPath = process.env["GITHUB_STEP_SUMMARY"];
  if (summaryPath) {
    const body = lines.length > 0 ? lines.join("\n") : "No violations found.";
    appendFileSync(
      summaryPath,
      `### a11y: ${surface}\n\n${blocking.length} serious/critical, ${results.violations.length} total\n\n${body}\n\n`,
    );
  }
}

test("login page", async ({ page }, testInfo) => {
  await page.goto("/login");
  await expect(page.getByLabel("Email")).toBeVisible();
  await scanAndReport(page, testInfo, "login");
});

test("operator check-in page", async ({ page }, testInfo) => {
  const seed = await readSeedData();

  await page.goto("/login");
  await page.getByLabel("Email").fill(seed.operatorEmail);
  await page.getByLabel("Password").fill(seed.operatorPassword);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/operator(\/|$)/);
  await page.goto(`/operator/events/${seed.eventId}/checkin`);

  await page.getByRole("button", { name: "Continue without label" }).click();
  await expect(
    page.getByRole("searchbox", { name: "QR scan or search" }),
  ).toBeVisible();

  await scanAndReport(page, testInfo, "operator-checkin");
});
