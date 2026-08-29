import { test, expect } from "@playwright/test";
import { readSeedData, seedCheckinE2eData } from "./seed.js";

/**
 * First browser-level E2E test in this repo (see AGENTS.md — no Playwright/Cypress coverage
 * existed before this). Covers exactly one path: an operator logging in and admitting an
 * attendee through the check-in page's manual lookup, asserting the status flip is real
 * (persisted server-side, verified by a fresh lookup after the admit) — not the camera/QR
 * scanning path, which needs real camera hardware or a mock that is a separate, harder problem.
 */

// globalSetup's seed only ever runs once per whole test run, not before each retry (CI runs with
// retries: 1) - a retry after a transient failure that happened AFTER "Confirm check-in" already
// admitted the attendee server-side would otherwise start from an already-admitted attendee, and
// fail immediately at the earlier "Ready to check in" assertion instead of getting a real chance
// to recover from whatever was actually transient. seedCheckinE2eData() is the same idempotent
// reset globalSetup already used - re-running it here before every attempt (first try or retry
// alike) keeps each attempt starting from the same known "not admitted" state.
test.beforeEach(async () => {
  await seedCheckinE2eData();
});

test("operator logs in, looks up an attendee manually, and admits them", async ({ page }) => {
  const seed = await readSeedData();

  await page.goto("/login");
  await page.getByLabel("Email").fill(seed.operatorEmail);
  await page.getByLabel("Password").fill(seed.operatorPassword);
  await page.getByRole("button", { name: "Sign in" }).click();

  // Land on the operator check-in surface for the seeded event.
  await page.waitForURL(/\/operator(\/|$)/);
  await page.goto(`/operator/events/${seed.eventId}/checkin`);

  // Post-login device-label step (apps/admin/src/pages/DeviceLabelStep.tsx) — skip it, the
  // test doesn't need a labeled device. It always renders for a fresh session (no
  // sessionStorage skip flag yet), but wait for it rather than checking visibility
  // instantly — the SPA is still mounting right after goto().
  await page.getByRole("button", { name: "Continue without label" }).click();

  // The scan-bar input renders with type="search" (checkinSearchFieldAttrs), so its accessible
  // role is "searchbox", not the plain-text-input "textbox".
  const searchField = page.getByRole("searchbox", { name: "QR scan or search" });
  await expect(searchField).toBeVisible();

  // Manual lookup path (not camera/QR scanning): type the seeded attendee's name and submit.
  // A single match opens their check-in card directly (apps/admin/src/pages/CheckInPage.tsx
  // handleLookupResults).
  await searchField.fill(seed.attendeeName);
  await searchField.press("Enter");

  await expect(page.getByRole("heading", { name: seed.attendeeName })).toBeVisible();
  await expect(page.getByText("Ready to check in")).toBeVisible();

  const confirmButton = page.getByRole("button", { name: "Confirm check-in" });
  await expect(confirmButton).toBeEnabled();
  await confirmButton.click();

  // Immediate optimistic result: the card's own status badge flips off "Ready to check in".
  await expect(confirmButton).toBeHidden();
  await expect(page.getByText("Valid", { exact: true })).toBeVisible();

  // Re-look the attendee up fresh — this is a real GET against the server, not client state —
  // to prove the admit was actually persisted, not just reflected optimistically in the UI.
  await searchField.fill(seed.attendeeName);
  await searchField.press("Enter");
  await expect(page.getByText("Already checked in")).toBeVisible();
});
