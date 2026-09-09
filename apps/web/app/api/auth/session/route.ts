import { getSession } from "@/lib/auth/utils";
import { NextResponse } from "next/server";

// Drop-in replacement for NextAuth's built-in GET/POST /api/auth/session —
// this is the one endpoint next-auth/react's useSession()/SessionProvider
// actually calls under the hood, so keeping its exact response shape
// ({} when logged out, {user, expires} when logged in) means all existing
// useSession() call sites across the app keep working unchanged, even though
// login/logout no longer go through NextAuth at all.
async function handler() {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({});
  }
  return NextResponse.json({
    user: session.user,
    expires: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString(),
  });
}

export const GET = handler;
// useSession()'s update() does a POST here (with a csrfToken it can no
// longer fetch, harmlessly ignored) — just re-read the current cookie.
export const POST = handler;
