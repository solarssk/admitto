import { appendFileSync, writeFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { test, expect, type Page, type TestInfo } from "@playwright/test";
import { signInAsAdmin } from "./admin-login.js";
import { readSeedData, seedCheckinE2eData } from "./seed.js";

/**
 * Accessibility scan (axe-core) over the surfaces this suite can already reach with its one seeded
 * operator account. Every violation is logged, saved as JSON under test-results/, and written to the
 * job summary; serious and critical ones also fail the test (minor/moderate stay report-only until
 * the baseline for them is triaged). A scan that evaluated nothing fails too. A page is scanned only
 * after it has settled (see `settle`), so axe reads the colours users end up seeing.
 */

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

/**
 * Resolves once a successful GET has come back for each of the given paths. Call it before the
 * action that makes the requests (a navigation or a click), so a fast response cannot be missed.
 */
function waitForGets(page: Page, pathnames: string[]): Promise<unknown> {
  return Promise.all(
    pathnames.map((pathname) =>
      page.waitForResponse(
        (res) =>
          new URL(res.url()).pathname === pathname &&
          res.request().method() === "GET" &&
          res.ok(),
      ),
    ),
  );
}

/**
 * Waits until the page has stopped changing under axe: no spinner is left, two animation frames
 * have let React commit what the responses just delivered, and every finite animation (content and
 * notices fade in over 150 ms) is over. axe reads colours mid-fade otherwise, and reports contrast
 * against a half-transparent text colour that is not what users end up seeing.
 */
async function settle(page: Page): Promise<void> {
  await expect(page.locator(".at-spinner")).toHaveCount(0);
  await page.evaluate(async () => {
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    await Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
        .map((a) => a.finished),
    );
  });
}

async function scanAndReport(
  page: Page,
  testInfo: TestInfo,
  surface: string,
  { blocking: failOnSerious = true }: { blocking?: boolean } = {},
): Promise<void> {
  // iframes are excluded: the only ones are the srcdoc mail-template previews on the Communication
  // page, whose content is the template's own HTML rather than the app's UI, and axe hangs
  // indefinitely trying to scan them.
  const results = await new AxeBuilder({ page })
    .exclude("iframe")
    .withTags(WCAG_TAGS)
    .analyze();

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

  if (failOnSerious) {
    // Soft, so one page's failure does not stop the remaining pages in the same test from being scanned.
    expect
      .soft(
        blocking.map((v) => `${v.id}: ${v.help}`),
        `serious/critical accessibility violations on ${surface}`,
      )
      .toEqual([]);
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

  // The click mounts the check-in page, which asks for the counts and the recent scans: listen first.
  const loaded = waitForGets(page, [
    "/api/checkin/stats",
    "/api/checkin/history",
  ]);
  await page.getByRole("button", { name: "Continue without label" }).click();
  await expect(
    page.getByRole("searchbox", { name: "QR scan or search" }),
  ).toBeVisible();
  await loaded;
  // The responses are in, but a placeholder that has been painted stays for at least 400 ms: both
  // blocks keep aria-busy until the loaded content replaces it. That content then fades in over
  // 150 ms, which settle() waits out.
  await expect(
    page.locator('.ck-stats[aria-busy="true"], .ck-recent[aria-busy="true"]'),
  ).toHaveCount(0);
  await settle(page);

  await scanAndReport(page, testInfo, "operator-checkin");
});

// Admin-side pages, scanned as the seeded superadmin. `blocking: false` marks a page whose current
// findings have not been fixed or triaged yet: it is still scanned and reported, but does not fail.
type Ids = { event: string; attendee: string };

// Each admin page, the API requests that carry its data (a page is only scanned after they have
// completed, so the scan sees real content rather than placeholders), and whether findings fail
// the test (all do today; `blocking: false` would mark a page with unfixed, untriaged findings).
const ADMIN_SURFACES: {
  name: string;
  path: (ids: Ids) => string;
  data: (ids: Ids) => string[];
  blocking: boolean;
}[] = [
  {
    name: "admin-events",
    path: () => "/admin",
    data: () => ["/api/admin/events"],
    blocking: true,
  },
  {
    name: "admin-overview",
    path: (i) => `/admin/events/${i.event}/overview`,
    data: (i) => [`/api/admin/events/${i.event}/overview`],
    blocking: true,
  },
  {
    name: "admin-attendees",
    path: (i) => `/admin/events/${i.event}/attendees`,
    data: (i) => [`/api/admin/events/${i.event}/attendees`],
    blocking: true,
  },
  {
    name: "admin-attendee-detail",
    path: (i) => `/admin/events/${i.event}/attendees/${i.attendee}`,
    data: (i) => [`/api/admin/events/${i.event}/attendees/${i.attendee}`],
    blocking: true,
  },
  {
    name: "admin-event-settings",
    path: (i) => `/admin/events/${i.event}/settings`,
    data: (i) => [`/api/admin/events/${i.event}/settings`],
    blocking: true,
  },
  {
    name: "admin-communication",
    path: (i) => `/admin/events/${i.event}/communication`,
    data: (i) => [
      `/api/admin/events/${i.event}/templates`,
      `/api/admin/events/${i.event}/deliveries`,
    ],
    blocking: true,
  },
  {
    // Not in the menu yet, so it is reached by its address. Its tabs are placeholders that read
    // nothing from the API (the event itself is read by the page frame, as for every page).
    name: "admin-registration",
    path: (i) => `/admin/events/${i.event}/registration`,
    data: () => [],
    blocking: true,
  },
];

test("admin pages", async ({ page, baseURL }, testInfo) => {
  // Seven pages, each waited for and scanned, plus the sign-in: more than the 30 s default.
  test.setTimeout(180_000);
  // Re-seed first: it resets the admin's MFA (a retry after a failed attempt could not enrol TOTP
  // again otherwise) and puts the attendee back to "not admitted", the state whose "Not yet" item
  // labels this test scans.
  await seedCheckinE2eData();
  const seed = await readSeedData();
  await signInAsAdmin(page, baseURL!, seed.adminEmail, seed.adminPassword);

  for (const surface of ADMIN_SURFACES) {
    const ids = { event: seed.eventId, attendee: seed.attendeeId };
    // Listeners are attached before navigating so a fast response cannot be missed.
    const loaded = waitForGets(page, surface.data(ids));
    await page.goto(surface.path(ids));
    await loaded;
    await expect(page.getByRole("heading").first()).toBeVisible();
    await settle(page);
    await scanAndReport(page, testInfo, surface.name, {
      blocking: surface.blocking,
    });
  }
});
