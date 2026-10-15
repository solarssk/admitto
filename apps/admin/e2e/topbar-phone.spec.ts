import { expect, test } from "@playwright/test";
import { signInAsAdmin } from "./admin-login.js";
import { readSeedData, seedCheckinE2eData } from "./seed.js";

/**
 * The top bar on a phone, as a seeded Superadmin sees it (the one role whose bar holds every button: menu, brand, system status, bell,
 * account). The main area is clipped, but a bar wider than the screen still lets it scroll sideways, and the click that opens the
 * account menu then does it in Chrome: the scroll closes the menu, so Sign out cannot be reached. The word beside the status dot was
 * what made the bar too wide (up to 431px on a 390px screen), so this fails if the bar outgrows the screen again, whatever the cause,
 * which the CSS tests in test/styles cannot see.
 */

// A phone with touch, the way the staff use the app at the door. `isMobile` and `hasTouch` belong to the browser context, so they are
// set for the file; the width changes per round below.
test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

// 390 and 360 are the common phones, 340 and 320 the narrowest the bar is made for (below 360 the logo stands without the Admitto name).
const WIDTHS = [390, 360, 340, 320];

test("the top bar fits a phone and the account menu stays open", async ({ page, baseURL }) => {
  test.setTimeout(120_000);
  // Re-seed first: it resets the admin's MFA, so a retry can enrol TOTP again (same reason as in a11y.spec.ts).
  await seedCheckinE2eData();
  const seed = await readSeedData();
  await signInAsAdmin(page, baseURL!, seed.adminEmail, seed.adminPassword);

  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/admin");
    const account = page.locator("button.user-menu__trigger:has(.user-avatar)");
    await expect(account).toBeVisible();
    // The status shows its verdict only once the checks have answered; that is the state whose word was wide.
    await expect(page.locator(".sys-status__dot--pending")).toHaveCount(0, { timeout: 15_000 });

    // On a phone the status is an icon, a shape that differs by state, not the dot (a colour); the Admitto name beside the logo goes below 360px.
    const status = page.locator(".sys-status__trigger");
    await expect(status.locator(".sys-status__cue")).toBeVisible();
    await expect(status.locator(".sys-status__dot")).toBeHidden();
    const wordmark = page.locator(".topbar__brand .brand-link__wordmark");
    if (width >= 360) await expect(wordmark).toBeVisible();
    else await expect(wordmark).toBeHidden();

    // The bar fits: nothing for the main area to scroll sideways, and the account button keeps the 16px of padding at the screen's edge.
    const main = page.locator("div.main");
    await expect
      .poll(() => main.evaluate((el) => el.scrollWidth - el.clientWidth), { message: `div.main scrolls sideways at ${width}px` })
      .toBeLessThanOrEqual(0);
    await expect
      .poll(() => account.evaluate((el) => window.innerWidth - el.getBoundingClientRect().right), {
        message: `the account button is closer than 16px to the screen's edge at ${width}px`,
      })
      .toBeGreaterThanOrEqual(15.5);

    // A mouse click is what closed the menu (a touch only shifted the page first): the scroll came within a few frames of the click.
    await account.click();
    const signOut = page.getByRole("menuitem", { name: "Sign out" });
    await expect(signOut).toBeVisible();
    for (let frame = 0; frame < 60; frame++) {
      await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
      expect(await signOut.isVisible(), `the account menu closed at ${width}px`).toBe(true);
    }
    await expect(signOut).toBeInViewport();
  }
});
