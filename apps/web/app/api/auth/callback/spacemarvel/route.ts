import { createId } from "@/lib/api/create-id";
import { authDebug } from "@/lib/auth/debug-log";
import { SESSION_COOKIE, SESSION_MAX_AGE, signSessionToken } from "@/lib/auth/jwt";
import { exchangeCodeForTokens, verifyIdToken } from "@/lib/auth/oidc-client";
import { ensureAdminWorkspace, ensurePartnerAccount } from "@/lib/auth/provisioning";
import { isBlacklistedEmail } from "@/lib/edge-config";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

// Same URL this app has always registered with the dashboard as its
// redirect_uri (/api/auth/callback/spacemarvel) — kept identical on purpose
// so no dashboard-side (spacemarvel_dashboard) re-registration is needed.
//
// Flow mirrors ChatPlatform-backend's GET /api/sso/oidc/callback
// (sso_oidc.py): validate state, exchange code w/ PKCE verifier, verify the
// id_token, look up the user by OIDC `sub` only (via the Account table —
// never by email, same anti-account-takeover posture as ChatPlatform), mint
// our own JWT, set it as the session cookie, redirect.
const isProd = !!process.env.VERCEL_URL;
const SESSION_COOKIE_DOMAIN = isProd ? ".dub.co" : "localhost";

function fail(req: NextRequest, reason: string, code: string) {
  authDebug("error", `OIDC callback failed: ${reason}`);
  return NextResponse.redirect(new URL(`/login?error=${code}`, req.url));
}

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const stateCookie = req.cookies.get("oidc_state")?.value;
  const verifier = req.cookies.get("oidc_verifier")?.value;
  const returnTo = req.cookies.get("oidc_return_to")?.value || "/";

  if (!code) return fail(req, "missing code", "OAuthCallback");
  if (!state || !stateCookie || state !== stateCookie) {
    return fail(req, "state mismatch or missing", "OAuthCallback");
  }
  if (!verifier) return fail(req, "missing pkce verifier cookie", "OAuthCallback");

  let profile;
  try {
    const redirectUri = `${process.env.NEXTAUTH_URL}/api/auth/callback/spacemarvel`;
    const tokens = await exchangeCodeForTokens({
      code,
      codeVerifier: verifier,
      redirectUri,
    });
    profile = await verifyIdToken(tokens.id_token);
  } catch (err) {
    authDebug("error", "OIDC token exchange/verification failed", {
      error: err instanceof Error ? err.message : err,
    });
    return fail(req, "token exchange/verification failed", "OAuthCallback");
  }

  if (!profile.email || (await isBlacklistedEmail(profile.email))) {
    return fail(req, "missing or blacklisted email", "OAuthSignin");
  }

  let account = await prisma.account.findUnique({
    where: {
      provider_providerAccountId: {
        provider: "spacemarvel",
        providerAccountId: profile.sub,
      },
    },
    select: { userId: true },
  });

  let userId: string;
  if (account) {
    userId = account.userId;
  } else {
    const user = await prisma.user.create({
      data: {
        id: createId({ prefix: "user_" }),
        name: profile.name || profile.email,
        email: profile.email,
        notificationPreferences: { create: {} },
      },
    });
    userId = user.id;
    await prisma.account.create({
      data: {
        userId,
        type: "oauth",
        provider: "spacemarvel",
        providerAccountId: profile.sub,
      },
    });
  }

  const isSuperAdmin = profile.is_super_admin === true;
  await prisma.user.update({ where: { id: userId }, data: { isSuperAdmin } });

  try {
    if (isSuperAdmin) {
      await ensureAdminWorkspace(userId);
    } else {
      await ensurePartnerAccount({ userId, email: profile.email, name: profile.name });
    }
  } catch (err) {
    authDebug("error", "Workspace/partner provisioning FAILED", {
      userId,
      isSuperAdmin,
      error: err instanceof Error ? err.stack || err.message : err,
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

  authDebug("session", "OIDC login complete, session token issued", {
    userId: user.id,
    isSuperAdmin: user.isSuperAdmin,
  });

  const res = NextResponse.redirect(new URL(returnTo, req.url));
  res.cookies.set("oidc_state", "", { path: "/", maxAge: 0 });
  res.cookies.set("oidc_verifier", "", { path: "/", maxAge: 0 });
  res.cookies.set("oidc_return_to", "", { path: "/", maxAge: 0 });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
    secure: isProd,
    domain: SESSION_COOKIE_DOMAIN,
  });
  return res;
}
