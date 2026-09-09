import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth/jwt";
import { UserProps } from "@/lib/types";
import { NextRequest } from "next/server";

export async function getUserViaToken(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) {
    // Dev-only, temporary: hard proof of whether the session cookie is
    // actually missing from this request (vs present-but-invalid) — same
    // raw-cookie-header technique used to pin down the earlier OIDC-state
    // cookie bug. Tracing whether sm_session survives the redirect from the
    // OIDC callback (localhost:3000) to wherever it lands next.
    if (process.env.NODE_ENV !== "production") {
      console.log("DEBUG getUserViaToken: no session cookie", {
        host: req.headers.get("host"),
        path: req.nextUrl.pathname,
        rawCookieHeader: req.headers.get("cookie"),
      });
    }
    return undefined;
  }
  return (await verifySessionToken(token)) as UserProps | undefined;
}
