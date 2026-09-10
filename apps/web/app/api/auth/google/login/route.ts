import { buildAuthorizeUrl, generatePkce, generateState } from "@/lib/auth/google-client";
import { NextRequest, NextResponse } from "next/server";

// dub_Affiliate's OWN Google login. Google's OAuth console rejects any
// *.localhost subdomain as a redirect URI ("must end with a public/private
// top-level domain") — only bare localhost:<port> is accepted. So in dev we
// always bounce to NEXTAUTH_URL's host for the actual round trip with
// Google; the PKCE state/verifier/return-to cookies are host-only and set
// AFTER the bounce, on the same host the callback will run on, so they
// survive fine. Getting the resulting session onto the real target host
// (e.g. partners.localhost:3000) is handled separately by the callback's
// handoff to /api/auth/consume — see callback/google/route.ts.
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
