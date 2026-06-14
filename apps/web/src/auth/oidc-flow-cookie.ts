import type { Context } from "hono";
import { setCookie, deleteCookie, getCookie } from "hono/cookie";
import { OIDC_FLOW_COOKIE_NAME } from "@admitto/auth";

const OIDC_FLOW_COOKIE_MAX_AGE = 600;

function oidcFlowCookieOptions(): {
  httpOnly: true;
  secure: boolean;
  sameSite: "Lax";
  path: string;
  maxAge: number;
} {
  return {
    httpOnly: true,
    secure: process.env["NODE_ENV"] !== "development",
    sameSite: "Lax",
    path: "/api/auth/oidc",
    maxAge: OIDC_FLOW_COOKIE_MAX_AGE,
  };
}

export function setOidcFlowCookie(c: Context, state: string): void {
  setCookie(c, OIDC_FLOW_COOKIE_NAME, state, oidcFlowCookieOptions());
}

export function clearOidcFlowCookie(c: Context): void {
  deleteCookie(c, OIDC_FLOW_COOKIE_NAME, { path: "/api/auth/oidc" });
}

export function oidcFlowCookieMatches(c: Context, state: string): boolean {
  const value = getCookie(c, OIDC_FLOW_COOKIE_NAME);
  return value === state;
}
