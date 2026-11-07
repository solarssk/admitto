/**
 * What the tests of the guest's company sign-in share (D-C4): a stand-in identity provider (the mock of the staff tests),
 * the rows that make it "the provider chosen for guests", events whose way in is the sign-in, a jar for the cookies of a
 * guest's browser, and a function that walks the whole flow the way a browser does. Every address and name here is synthetic.
 */
import { encryptClientSecret } from "@admitto/auth";
import type { PrismaClient } from "@admitto/db";
import { setEnabledAccessMethods } from "../../src/registration/access-methods.js";
import { GUEST_SSO_CALLBACK_PATH, GUEST_SSO_SESSION_COOKIE } from "../../src/registration/sso-session.js";
import { GUEST_SSO_FLOW_COOKIE_PREFIX, parseGuestSsoStateValue } from "../../src/registration/sso-state-value.js";
import { SSO_PROVIDER_SETTINGS_KEY, setSsoProviderId } from "../../src/registration/sso-provider.js";
import type { MockIdTokenOverrides, MockOidcIdp } from "./mock-oidc-idp.js";
import { ORIGIN } from "./registration-submit-harness.js";

export { GUEST_SSO_CALLBACK_PATH, GUEST_SSO_FLOW_COOKIE_PREFIX, GUEST_SSO_SESSION_COOKIE };

/** The name of the flow cookie of the flow that began with this `state` (the state must be one the system wrote). */
export const flowCookieName = (state: string): string => parseGuestSsoStateValue(state)!.cookieName;

export const PROVIDER_ID = "reg118a-guest-idp";

/** The identity provider row that points at the mock, enabled, and chosen for guests; the company sign-in switched on. */
export async function installProvider(prisma: PrismaClient, idp: MockOidcIdp, options: { enabled?: boolean } = {}): Promise<void> {
  await prisma.identityProvider.deleteMany({ where: { id: PROVIDER_ID } });
  await prisma.identityProvider.create({
    data: {
      id: PROVIDER_ID,
      provider_type: "oidc",
      issuer: idp.issuer,
      client_id: "test-oidc-client",
      client_secret_enc: encryptClientSecret("mock-secret"),
      authorization_endpoint: idp.authorizeEndpoint,
      token_endpoint: idp.tokenEndpoint,
      jwks_uri: idp.jwksUri,
      display_name: "Guest IdP",
      enabled: options.enabled ?? true,
    },
  });
  await setSsoProviderId(prisma, PROVIDER_ID);
  await setEnabledAccessMethods(prisma, ["sso"]);
}

export async function removeProvider(prisma: PrismaClient): Promise<void> {
  await prisma.systemSettings.deleteMany({ where: { key: SSO_PROVIDER_SETTINGS_KEY } });
  await prisma.identityProvider.deleteMany({ where: { id: PROVIDER_ID } });
}

type Cookie = { value: string; path: string; maxAge: number | null; line: string };

/** The cookies of one guest's browser, kept the way a browser keeps them: by name and path, deleted by Max-Age 0. */
export class Jar {
  private readonly cookies = new Map<string, Cookie>();

  /** Takes in what a response sets. */
  absorb(res: Response): void {
    for (const line of res.headers.getSetCookie()) {
      const [pair = "", ...attributes] = line.split(";").map((part) => part.trim());
      const eq = pair.indexOf("=");
      const name = pair.slice(0, eq);
      const value = pair.slice(eq + 1);
      const attr = (key: string) => attributes.find((entry) => entry.toLowerCase().startsWith(`${key}=`))?.slice(key.length + 1);
      const path = attr("path") ?? "/";
      const maxAge = attr("max-age") === undefined ? null : Number(attr("max-age"));
      const key = `${name}@${path}`;
      if (maxAge === 0 || value === "") this.cookies.delete(key);
      else this.cookies.set(key, { value, path, maxAge, line });
    }
  }

  /** The Cookie header for a request to `path`: the cookies whose path covers it. */
  header(path: string): string {
    return [...this.cookies.entries()]
      .filter(([, cookie]) => path === cookie.path || path.startsWith(`${cookie.path}/`))
      .map(([key, cookie]) => `${key.split("@")[0]}=${cookie.value}`)
      .join("; ");
  }

  has(name: string): boolean {
    return [...this.cookies.keys()].some((key) => key.startsWith(`${name}@`));
  }

  value(name: string): string | undefined {
    return [...this.cookies.entries()].find(([key]) => key.startsWith(`${name}@`))?.[1].value;
  }

  /** Puts a cookie in by hand, as a guest who builds one would. */
  set(name: string, value: string, path: string): void {
    this.cookies.set(`${name}@${path}`, { value, path, maxAge: null, line: "" });
  }

  /** The names of the flow cookies the browser holds. */
  flowNames(): string[] {
    return this.names().filter((name) => name.startsWith(GUEST_SSO_FLOW_COOKIE_PREFIX));
  }

  names(): string[] {
    return [...this.cookies.keys()].map((key) => key.split("@")[0]!);
  }
}

export type App = { request: (input: string, init?: RequestInit) => Response | Promise<Response> };

export const startPath = (slug: string) => `/r/${slug}/sso/start`;
export const callbackPath = () => GUEST_SSO_CALLBACK_PATH;

/** A request of the browser of `jar`, with the cookies its paths allow. */
export function browse(app: App, jar: Jar, path: string, init: RequestInit = {}): Promise<Response> {
  const cookie = jar.header(path.split("?")[0]!);
  return Promise.resolve(app.request(`${ORIGIN}${path}`, { redirect: "manual", ...init, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(init.headers as Record<string, string> | undefined) } })).then((res) => {
    jar.absorb(res);
    return res;
  });
}

export interface Walk {
  start: Response;
  /** The address the browser was sent to at the provider. */
  authorizeUrl: URL;
  state: string;
  nonce: string;
  /** The address the provider sends the browser back to (what the callback is called with). */
  callbackUrl: URL;
  callback: Response;
}

/** The part of the flow before the callback: the browser starts, is sent to the provider, and the provider sends it back. */
export async function goToProvider(app: App, jar: Jar, slug: string, idp: MockOidcIdp, token?: MockIdTokenOverrides) {
  const start = await browse(app, jar, startPath(slug));
  const authorizeUrl = new URL(start.headers.get("location")!);
  const state = authorizeUrl.searchParams.get("state")!;
  const nonce = authorizeUrl.searchParams.get("nonce")!;
  if (token) idp.setNextToken(token);
  const back = await fetch(authorizeUrl.toString(), { redirect: "manual" });
  const callbackUrl = new URL(back.headers.get("location")!);
  return { start, authorizeUrl, state, nonce, callbackUrl };
}

/** The whole flow, the way a browser walks it. `token` chooses what the provider puts in the ID token. */
export async function walk(app: App, jar: Jar, slug: string, idp: MockOidcIdp, token?: MockIdTokenOverrides): Promise<Walk> {
  const before = await goToProvider(app, jar, slug, idp, token);
  const callback = await browse(app, jar, `${before.callbackUrl.pathname}${before.callbackUrl.search}`);
  return { ...before, callback };
}
