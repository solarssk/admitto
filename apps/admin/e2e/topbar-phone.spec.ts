import { expect, test } from "@playwright/test";
import { signInAsAdmin } from "./admin-login.js";
import { readSeedData, seedCheckinE2eData } from "./seed.js";

/**
 * The top bar on a phone, as a seeded Superadmin sees it (the one role whose bar holds every button: menu, brand, system status, bell,
 * account). `div.main` is `overflow: hidden`, but a bar wider than the screen still lets it scroll sideways, and the click that opens
 * the account menu then does it in Chrome: the scroll closes the menu, so Sign out cannot be reached. The word beside the status dot
 * was what made the bar too wide (up to 431px on a 390px screen), so this fails if the bar outgrows the screen again, whatever the
 * cause, which the CSS tests in test/styles cannot see.
 */

// A phone with touch, the way the staff use the app at the door. `isMobile` and `hasTouch` belong to the browser context, so they are
// set for the file; the width changes per round below.
test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

test("the top bar fits a phone and the account menu stays open", async ({ page, baseURL }) => {
  test.setTimeout(90_000);
  // Re-seed first: it resets the admin's MFA, so a retry can enrol TOTP again (same reason as in a11y.spec.ts).
  await seedCheckinE2eData();
  const seed = await readSeedData();
  await signInAsAdmin(page, baseURL!, seed.adminEmail, seed.adminPassword);

  for (const width of [390, 360]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/admin");
    const account = page.locator("button.user-menu__trigger:has(.user-avatar)");
    await expect(account).toBeVisible();
    // The status shows its verdict only once the checks have answered; that is the state whose word was wide.
    await expect(page.locator(".sys-status__dot--pending")).toHaveCount(0, { timeout: 15_000 });

    const main = page.locator("div.main");
    await expect
      .poll(() => main.evaluate((el) => el.scrollWidth - el.clientWidth), { message: `div.main scrolls sideways at ${width}px` })
      .toBeLessThanOrEqual(0);

    // A mouse click is what closed the menu (a touch only shifted the page first): the scroll came within 100ms of the click.
    await account.click();
    const signOut = page.getByRole("menuitem", { name: "Sign out" });
    await expect(signOut).toBeVisible();
    await page.waitForTimeout(600);
    await expect(signOut, `the account menu closed at ${width}px`).toBeVisible();
    await expect(signOut).toBeInViewport();
  }
});
