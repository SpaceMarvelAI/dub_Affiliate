import { buildAuthorizeUrl, generatePkce, generateState } from "@/lib/auth/oidc-client";
import { NextRequest, NextResponse } from "next/server";

// Starts the OIDC login round trip — mirrors ChatPlatform-backend's
// GET /api/sso/oidc/login (sso_oidc.py): generate state + PKCE, stash them in
// short-lived cookies, redirect straight to the dashboard's /authorize. One
// request, no client-side fetch dance — unlike NextAuth's signIn(), which did
// separate csrf/providers/signin fetches before ever redirecting.
//
// These cookies have to survive a REAL external round trip (dashboard ->
// WorkOS -> Google -> WorkOS -> dashboard -> us), not just an internal hop.
// Proven via raw-cookie-header logging: Domain=localhost cookies do NOT
// reliably survive that (they arrived empty on the real callback request,
// while a Domain=localhost session cookie set the normal way — after
// returning, not before leaving — worked fine). Host-only cookies are the
// setting that's actually been shown to work for a cookie that has to
// survive leaving the site and coming back.
//
// That conflicts with the OTHER requirement — the dashboard's registered
// redirect_uri is always localhost:3000, so login can start on a different
// host (partners.localhost). Solution: bounce to the canonical host FIRST,
// before ever leaving to the dashboard, so these cookies are always
// set-and-read on the exact one host (localhost:3000) the callback lands
// on — no cross-host cookie sharing needed at all.
const isProd = !!process.env.VERCEL_URL;
const PROTOCOL = isProd ? "https" : "http";
// Computed inside the handler, not at module scope — NEXTAUTH_URL isn't
// set during the Docker build (.env is excluded from the build context),
// and evaluating `new URL(...)` at module load throws "Invalid URL"
// during Next's build-time page-data collection, breaking the whole build.
function getCanonicalHost() {
  return new URL(process.env.NEXTAUTH_URL!).host;
}

const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  // 20 minutes, not 5 — the dashboard's "Continue with Google" path now
  // routes through WorkOS + Google's own account-picker/consent/2FA screens
  // before ever coming back, which can easily take longer than 5 minutes on
  // a first-time authorization. These cookies are single-use and deleted
  // immediately once consumed, so a longer window costs nothing.
  maxAge: 1200,
  secure: isProd,
  // host-only (no domain) — see comment above.
};

export async function GET(req: NextRequest) {
  const canonicalHost = getCanonicalHost();
  const host = req.headers.get("host");
  const next = req.nextUrl.searchParams.get("next");
  const path = next && next.startsWith("/") ? next : "/";

  if (host !== canonicalHost) {
    const url = new URL(
      `/api/auth/login${req.nextUrl.search}`,
      `${PROTOCOL}://${canonicalHost}`,
    );
    if (!url.searchParams.get("next")) url.searchParams.set("next", path);
    // Where to send the user back to once login fully completes — carried
    // as a query param through this one same-site internal hop, not a
    // cookie, since nothing sensitive happens until the real OIDC round
    // trip starts (which begins fresh on the canonical host below).
    url.searchParams.set("returnHost", host ?? canonicalHost);
    return NextResponse.redirect(url);
  }

  const returnHost = req.nextUrl.searchParams.get("returnHost") || host;
  const returnTo = `${PROTOCOL}://${returnHost}${path}`;

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
