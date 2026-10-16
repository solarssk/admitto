import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Drift guard: the staff app sends the browser to the sign-in page only through `goToLogin`
 * (`src/auth/login-navigation.ts`), which stands down while the user's own Sign out is under way. A direct
 * `location.assign("/login...")` anywhere else would let a 401 that the sign-out itself causes, on a request that
 * was already in flight, replace the trip to the identity provider's logout page.
 */
const SRC = join(dirname(fileURLToPath(import.meta.url)), "../../src");
const HELPER = join(SRC, "auth/login-navigation.ts");
const DIRECT_LOGIN_NAVIGATION = /location\s*(?:\.\s*(?:assign|replace)\(\s*|\.\s*href\s*=\s*)[`'"]\/login/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(?:ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

describe("redirects to the sign-in page (apps/admin/src)", () => {
  it("none bypasses goToLogin", () => {
    const offenders = sourceFiles(SRC)
      .filter((file) => file !== HELPER)
      .filter((file) => DIRECT_LOGIN_NAVIGATION.test(readFileSync(file, "utf8")))
      .map((file) => relative(SRC, file));

    expect(
      offenders,
      'Send the browser to "/login..." with goToLogin(url) from src/auth/login-navigation.ts, not window.location.assign: it stands down while the user\'s Sign out is under way.',
    ).toEqual([]);
  });

  it("the pattern does catch the forms it is meant to catch", () => {
    expect(DIRECT_LOGIN_NAVIGATION.test("window.location.assign(`/login?next=${next}`);")).toBe(true);
    expect(DIRECT_LOGIN_NAVIGATION.test('window.location.assign("/login");')).toBe(true);
    expect(DIRECT_LOGIN_NAVIGATION.test("window.location.replace('/login');")).toBe(true);
    expect(DIRECT_LOGIN_NAVIGATION.test('window.location.href = "/login";')).toBe(true);
    expect(DIRECT_LOGIN_NAVIGATION.test("window.location.assign(`/account/oidc/${id}/link?next=/account`);")).toBe(false);
    expect(DIRECT_LOGIN_NAVIGATION.test("goToLogin(`/login?next=${next}`);")).toBe(false);
  });
});
