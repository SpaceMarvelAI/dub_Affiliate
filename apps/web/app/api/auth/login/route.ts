import { buildAuthorizeUrl, generatePkce, generateState } from "@/lib/auth/oidc-client";
import { NextRequest, NextResponse } from "next/server";

// Starts the OIDC login round trip — mirrors ChatPlatform-backend's
// GET /api/sso/oidc/login (sso_oidc.py): generate state + PKCE, stash them in
// short-lived cookies, redirect straight to the dashboard's /authorize. One
// request, no client-side fetch dance — unlike NextAuth's signIn(), which did
// separate csrf/providers/signin fetches before ever redirecting.
const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  maxAge: 300, // 5 minutes — single-use, only needs to survive the redirect round trip
  secure: !!process.env.VERCEL_URL,
};

export async function GET(req: NextRequest) {
  const next = req.nextUrl.searchParams.get("next");
  const returnTo = next && next.startsWith("/") ? next : "/";

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
