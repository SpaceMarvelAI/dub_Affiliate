"use client";

// Drop-in replacement for next-auth/react's signOut(), now that logout is
// our own route instead of NextAuth's. useSession()/SessionProvider still
// come from next-auth/react unchanged — see app/api/auth/session/route.ts.
//
// The SpaceMarvel SSO sign-in button was removed from login-form.tsx (login
// is now Google + email/password, its own separate flow) — the
// /api/auth/login + /api/auth/callback/spacemarvel routes still exist and
// still work, just unlinked from the UI. Say so if you want them fully
// removed rather than just unlinked.
export async function signOut({
  callbackUrl = "/login",
}: { callbackUrl?: string } = {}) {
  try {
    // Clears every cookie on the request, including our session cookie —
    // see app/api/auth/clear-all/route.ts.
    await fetch("/api/auth/clear-all", { method: "POST" });
  } catch {
    // best-effort — still redirect below
  }
  window.location.href = callbackUrl;
}
