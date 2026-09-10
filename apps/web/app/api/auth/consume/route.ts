import {
  SESSION_COOKIE,
  SESSION_MAX_AGE,
  signSessionToken,
  verifyHandoffToken,
} from "@/lib/auth/jwt";
import { NextRequest, NextResponse } from "next/server";

// Lands the dev-only cross-host Google login handoff (see
// app/api/auth/callback/google/route.ts): the OAuth round trip had to run
// on the canonical host (localhost:3000), so the session is carried here in
// a short-lived signed token instead of a cookie. This request's own host IS
// the real target (e.g. partners.localhost:3000), so the session cookie set
// here is host-only and just works — no cross-subdomain sharing needed.
const isProd = !!process.env.VERCEL_URL;

export async function GET(req: NextRequest) {
  const handoff = req.nextUrl.searchParams.get("token");
  const next = req.nextUrl.searchParams.get("next");
  const path = next && next.startsWith("/") ? next : "/";

  const user = handoff ? await verifyHandoffToken(handoff) : null;
  if (!user) {
    return NextResponse.redirect(new URL("/login?error=OAuthCallback", req.url));
  }

  const token = await signSessionToken(user);
  const res = NextResponse.redirect(new URL(path, req.url));
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
    secure: isProd,
  });
  return res;
}
