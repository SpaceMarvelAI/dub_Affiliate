import { buildAuthorizeUrl, generatePkce, generateState } from "@/lib/auth/oidc-client";
import { NextRequest, NextResponse } from "next/server";

// Starts the OIDC login round trip — mirrors ChatPlatform-backend's
// GET /api/sso/oidc/login (sso_oidc.py): generate state + PKCE, stash them in
// short-lived cookies, redirect straight to the dashboard's /authorize. One
// request, no client-side fetch dance — unlike NextAuth's signIn(), which did
// separate csrf/providers/signin fetches before ever redirecting.
//
// This app has multiple local hostnames (localhost, partners.localhost) but
// the dashboard's registered redirect_uri is always localhost:3000 — so login
// can start on one host and the callback always lands on another. These
// cookies MUST be Domain-scoped (not host-only) to survive that, same as the
// session cookie already is.
const isProd = !!process.env.VERCEL_URL;
export const OIDC_COOKIE_DOMAIN = isProd ? ".dub.co" : "localhost";

const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  maxAge: 300, // 5 minutes — single-use, only needs to survive the redirect round trip
  secure: isProd,
  domain: OIDC_COOKIE_DOMAIN,
};

export async function GET(req: NextRequest) {
  const next = req.nextUrl.searchParams.get("next");
  const path = next && next.startsWith("/") ? next : "/";
  // Store the full origin, not just the path — the callback always executes
  // on localhost:3000 (the registered redirect_uri), so without this a login
  // started on partners.localhost would land back on the wrong host.
  //
  // req.nextUrl.origin is NOT reliable here — this route bypasses
  // middleware.ts (matcher excludes /api/), and outside it NextURL doesn't
  // reflect the real incoming Host header, only whatever the dev server's
  // own canonical address is. lib/middleware/utils/parse.ts hits the same
  // issue and works around it the same way: read the Host header directly.
  const host = req.headers.get("host");
  const protocol = isProd ? "https" : "http";
  const returnTo = `${protocol}://${host}${path}`;

  const { verifier, challenge } = generatePkce();
  const state = generateState();
  const redirectUri = `${process.env.NEXTAUTH_URL}/api/auth/callback/spacemarvel`;

  const res = NextResponse.redirect(
    buildAuthorizeUrl({ redirectUri, state, codeChallenge: challenge }),
  );
  res.cookies.set("oidc_state", state, COOKIE_OPTS);
  res.cookies.set("oidc_verifier", verifier, COOKIE_OPTS);
  res.cookies.set("oidc_return_to", returnTo, COOKIE_OPTS);
  return res;
}
