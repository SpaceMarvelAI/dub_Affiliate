import { createId } from "@/lib/api/create-id";
import { authDebug } from "@/lib/auth/debug-log";
import { exchangeCodeForTokens, verifyIdToken } from "@/lib/auth/google-client";
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE,
  signHandoffToken,
  signSessionToken,
} from "@/lib/auth/jwt";
import { ensurePartnerAccount } from "@/lib/auth/provisioning";
import { isBlacklistedEmail } from "@/lib/edge-config";
import { prisma } from "@/lib/prisma";
import {
  API_HOSTNAMES,
  APP_HOSTNAMES,
  PARTNERS_HOSTNAMES,
} from "@dub/utils";
import { NextRequest, NextResponse } from "next/server";

// dub_Affiliate's OWN Google login callback. In dev this always runs on the
// canonical host (localhost:3000 — Google's console rejects any *.localhost
// subdomain as a redirect URI), which is usually NOT the host the user
// actually wants to end up on (e.g. partners.localhost:3000). Rather than
// share the session via a Domain=localhost cookie — confirmed unreliable
// across *.localhost subdomains in real browsers — a cross-host return
// hands off via a short-lived signed token to /api/auth/consume on the
// target host, which sets the real session cookie there directly. In prod,
// partners.dub.co etc. are real registrable domains: Google accepts them as
// redirect URIs directly, callback and returnTo host always match, and the
// session cookie gets Domain=.dub.co for real cross-subdomain SSO — the
// handoff path is never exercised there.
const isProd = process.env.NODE_ENV === "production";
const PROTOCOL = isProd ? "https" : "http";

// Was hardcoded to ".dub.co" — silently broke every non-dub.co deployment
// (e.g. affiliate.spacemarvel.com): a cookie's Domain attribute must be the
// request's own host or a registrable parent of it, and dub.co isn't a
// parent of spacemarvel.com, so browsers reject the Set-Cookie outright
// (this is exactly why the session cookie never showed up here while the
// three host-only pre-auth cookies did). Derive it from the actual request
// host instead. Cross-subdomain sharing only applies to genuine multi-label
// hosts (app.dub.co, affiliate.spacemarvel.com); a bare/apex host gets a
// host-only cookie, which is exactly right for a single-hostname deployment.
function getCookieDomain(host: string): string | undefined {
  if (!isProd) return undefined;
  const labels = host.split(":")[0].split(".");
  if (labels.length <= 2) return undefined;
  return `.${labels.slice(-2).join(".")}`;
}

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
  const host = req.headers.get("host")!;
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
    const redirectUri = `${PROTOCOL}://${host}/api/auth/callback/google`;
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

  // This app's Google login IS the partner-facing signup path (the separate
  // SpaceMarvel/OIDC login is for internal admins) — every Google-authed
  // user should end up with a partner profile and a defaultPartnerId, the
  // same way the OIDC callback provisions one for non-admins. Idempotent
  // (upserts), so this is safe and cheap to run on every login, not just
  // account creation.
  await ensurePartnerAccount({
    userId,
    email: profile.email,
    name: profile.name,
  });

  let user = await prisma.user.findUniqueOrThrow({
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

  // Backfill the profile picture from Google when this user's row predates
  // it or was never linked through Google before (e.g. an existing
  // password-signup account matched by email above) — otherwise `image`
  // stays null forever even though Google is handing us a real picture on
  // every login.
  if (profile.picture && profile.picture !== user.image) {
    user = await prisma.user.update({
      where: { id: user.id },
      data: { image: profile.picture },
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
  }

  const sessionUser = {
    id: user.id,
    name: user.name || "",
    email: user.email || "",
    image: user.image,
    isMachine: user.isMachine,
    isSuperAdmin: user.isSuperAdmin,
    defaultWorkspace: user.defaultWorkspace,
    defaultPartnerId: user.defaultPartnerId,
  };

  authDebug("session", "Google login complete, session token issued", {
    userId: user.id,
  });

  const isCrossHost = returnTo.host !== host;

  let res: NextResponse;
  if (isCrossHost) {
    const handoff = await signHandoffToken(sessionUser);
    const consumeUrl = new URL("/api/auth/consume", returnTo.origin);
    consumeUrl.searchParams.set("token", handoff);
    consumeUrl.searchParams.set("next", returnTo.pathname + returnTo.search);
    res = NextResponse.redirect(consumeUrl);
  } else {
    const token = await signSessionToken(sessionUser);
    res = NextResponse.redirect(returnTo);
    res.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_MAX_AGE,
      secure: isProd,
      ...(getCookieDomain(host) ? { domain: getCookieDomain(host) } : {}),
    });
  }

  for (const name of ["google_state", "google_verifier", "google_return_to"]) {
    res.cookies.set(name, "", { path: "/", maxAge: 0 });
  }
  return res;
}
