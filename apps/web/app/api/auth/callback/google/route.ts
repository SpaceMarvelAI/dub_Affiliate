import { createId } from "@/lib/api/create-id";
import { authDebug } from "@/lib/auth/debug-log";
import { exchangeCodeForTokens, verifyIdToken } from "@/lib/auth/google-client";
import { SESSION_COOKIE, SESSION_MAX_AGE, signSessionToken } from "@/lib/auth/jwt";
import { isBlacklistedEmail } from "@/lib/edge-config";
import { prisma } from "@/lib/prisma";
import {
  API_HOSTNAMES,
  APP_HOSTNAMES,
  PARTNERS_HOSTNAMES,
} from "@dub/utils";
import { NextRequest, NextResponse } from "next/server";

// dub_Affiliate's OWN Google login callback — same structure as
// app/api/auth/callback/spacemarvel/route.ts (validate state, exchange code
// w/ PKCE verifier, verify id_token, find-or-create user by provider `sub`,
// mint our own session JWT), and the same fix for the confirmed
// browser redirect-chain cookie wipe: a rendered HTML page + client-side
// navigation for any cross-host landing, not a raw 3xx chain.
const isProd = !!process.env.VERCEL_URL;
const COOKIE_DOMAIN = isProd ? ".dub.co" : "localhost";
const KNOWN_HOSTNAMES = new Set([
  ...APP_HOSTNAMES,
  ...PARTNERS_HOSTNAMES,
  ...API_HOSTNAMES,
]);

function fail(req: NextRequest, reason: string, code: string) {
  authDebug("error", `Google callback failed: ${reason}`);
  return NextResponse.redirect(new URL(`/login?error=${code}`, req.url));
}

function resolveReturnTo(req: NextRequest, raw: string | undefined) {
  if (raw) {
    try {
      const url = new URL(raw);
      if (KNOWN_HOSTNAMES.has(url.host)) return url;
    } catch {
      // fall through to default below
    }
  }
  return new URL("/", req.url);
}

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const stateCookie = req.cookies.get("google_state")?.value;
  const verifier = req.cookies.get("google_verifier")?.value;
  const returnTo = resolveReturnTo(req, req.cookies.get("google_return_to")?.value);

  if (!code) return fail(req, "missing code", "OAuthCallback");
  if (!state || !stateCookie || state !== stateCookie) {
    return fail(req, "state mismatch or missing", "OAuthCallback");
  }
  if (!verifier) return fail(req, "missing pkce verifier cookie", "OAuthCallback");

  let profile;
  try {
    const redirectUri = `${process.env.NEXTAUTH_URL}/api/auth/callback/google`;
    const tokens = await exchangeCodeForTokens({
      code,
      codeVerifier: verifier,
      redirectUri,
    });
    profile = await verifyIdToken(tokens.id_token);
  } catch (err) {
    authDebug("error", "Google token exchange/verification failed", {
      error: err instanceof Error ? err.message : err,
    });
    return fail(req, "token exchange/verification failed", "OAuthCallback");
  }

  if (
    !profile.email ||
    !profile.email_verified ||
    (await isBlacklistedEmail(profile.email))
  ) {
    return fail(req, "missing/unverified/blacklisted email", "OAuthSignin");
  }

  let account = await prisma.account.findUnique({
    where: {
      provider_providerAccountId: {
        provider: "google",
        providerAccountId: profile.sub,
      },
    },
    select: { userId: true },
  });

  let userId: string;
  if (account) {
    userId = account.userId;
  } else {
    // Same email-fallback as the SpaceMarvel callback: Google's own
    // email_verified check above is what makes this safe (a verified claim
    // from Google, not user-typed input) — re-link rather than crash on the
    // unique email constraint if this person already has a User row under a
    // different provider/sub.
    const existingUser = await prisma.user.findUnique({
      where: { email: profile.email },
      select: { id: true },
    });

    if (existingUser) {
      userId = existingUser.id;
    } else {
      const user = await prisma.user.create({
        data: {
          id: createId({ prefix: "user_" }),
          name: profile.name || profile.email,
          email: profile.email,
          image: profile.picture || null,
          notificationPreferences: { create: {} },
        },
      });
      userId = user.id;
    }
    await prisma.account.create({
      data: {
        userId,
        type: "oauth",
        provider: "google",
        providerAccountId: profile.sub,
      },
    });
  }

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      image: true,
      isMachine: true,
      isSuperAdmin: true,
      defaultWorkspace: true,
      defaultPartnerId: true,
    },
  });

  const token = await signSessionToken({
    id: user.id,
    name: user.name || "",
    email: user.email || "",
    image: user.image,
    isMachine: user.isMachine,
    isSuperAdmin: user.isSuperAdmin,
    defaultWorkspace: user.defaultWorkspace,
    defaultPartnerId: user.defaultPartnerId,
  });

  authDebug("session", "Google login complete, session token issued", {
    userId: user.id,
  });

  const host = req.headers.get("host");
  const isCrossHost = returnTo.host !== host;

  let res: NextResponse;
  if (isCrossHost) {
    res = new NextResponse(
      `<!doctype html><meta charset="utf-8"><title>Signing you in…</title>` +
        `<p>Signing you in…</p>` +
        `<script>window.location.replace(${JSON.stringify(returnTo.toString())})</script>`,
      { headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
  } else {
    res = NextResponse.redirect(returnTo);
  }

  for (const name of ["google_state", "google_verifier", "google_return_to"]) {
    res.cookies.set(name, "", { path: "/", maxAge: 0 });
  }
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
    secure: isProd,
    domain: COOKIE_DOMAIN,
  });
  return res;
}
