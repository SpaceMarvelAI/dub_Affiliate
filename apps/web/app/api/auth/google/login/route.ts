import { buildAuthorizeUrl, generatePkce, generateState } from "@/lib/auth/google-client";
import { NextRequest, NextResponse } from "next/server";

// dub_Affiliate's OWN Google login — same host-only-cookie / canonical-host-
// bounce pattern as app/api/auth/login/route.ts (the SpaceMarvel one), for
// the same proven reason: these cookies have to survive a real external
// round trip to Google and back, which only host-only cookies reliably do.
const isProd = !!process.env.VERCEL_URL;
const CANONICAL_HOST = new URL(process.env.NEXTAUTH_URL!).host;
const PROTOCOL = isProd ? "https" : "http";

const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  maxAge: 1200,
  secure: isProd,
};

export async function GET(req: NextRequest) {
  const host = req.headers.get("host");
  const next = req.nextUrl.searchParams.get("next");
  const path = next && next.startsWith("/") ? next : "/";

  if (host !== CANONICAL_HOST) {
    const url = new URL(
      `/api/auth/google/login${req.nextUrl.search}`,
      `${PROTOCOL}://${CANONICAL_HOST}`,
    );
    if (!url.searchParams.get("next")) url.searchParams.set("next", path);
    url.searchParams.set("returnHost", host ?? CANONICAL_HOST);
    return NextResponse.redirect(url);
  }

  const returnHost = req.nextUrl.searchParams.get("returnHost") || host;
  const returnTo = `${PROTOCOL}://${returnHost}${path}`;

  const { verifier, challenge } = generatePkce();
  const state = generateState();
  const redirectUri = `${process.env.NEXTAUTH_URL}/api/auth/callback/google`;

  const res = NextResponse.redirect(
    buildAuthorizeUrl({ redirectUri, state, codeChallenge: challenge }),
  );
  res.cookies.set("google_state", state, COOKIE_OPTS);
  res.cookies.set("google_verifier", verifier, COOKIE_OPTS);
  res.cookies.set("google_return_to", returnTo, COOKIE_OPTS);
  return res;
}
