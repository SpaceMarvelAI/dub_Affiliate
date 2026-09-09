"use client";

// Drop-in replacements for next-auth/react's signIn()/signOut(), now that
// login/logout are our own OIDC routes instead of NextAuth's. useSession()/
// SessionProvider still come from next-auth/react unchanged — see
// app/api/auth/session/route.ts.
export function signIn(next?: string) {
  window.location.href = next
    ? `/api/auth/login?next=${encodeURIComponent(next)}`
    : "/api/auth/login";
}

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
