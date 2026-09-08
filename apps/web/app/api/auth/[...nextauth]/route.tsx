import { authOptions } from "@/lib/auth";
import { authDebug } from "@/lib/auth/debug-log";
import NextAuth from "next-auth";
import { NextRequest } from "next/server";

const nextAuthHandler = NextAuth(authOptions);

// Dev-only: log the RAW cookie header on the callback request before NextAuth
// touches it. "State cookie was missing" only ever means req.cookies had no
// key named "next-auth.state" — this proves definitively whether the browser
// is actually sending that cookie at all, instead of guessing from Domain/
// SameSite theory. (authDebug itself is a no-op in production.)
const GET = async (
  req: NextRequest,
  context: { params: Promise<{ nextauth: string[] }> },
) => {
  if (req.nextUrl.pathname.includes("/callback/")) {
    authDebug("error", "RAW cookie header on OIDC callback request", {
      url: req.nextUrl.toString(),
      cookieHeader: req.headers.get("cookie"),
    });
  }
  // @ts-ignore — next-auth's App Router handler type predates the Next 15
  // change to async `params`; this repo is already on Next 15 elsewhere.
  return nextAuthHandler(req, context);
};

export { GET, nextAuthHandler as POST };
