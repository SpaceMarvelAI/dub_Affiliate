import * as client from "openid-client";
import { Router } from "express";
import { getOidcConfig } from "../lib/oidc";
import { prisma } from "../lib/prisma";
import { SESSION_COOKIE, signSession } from "../lib/session";

const router = Router();

const REDIRECT_URI = process.env.OIDC_REDIRECT_URI!;
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";

const STATE_COOKIE = "oidc_state";
const VERIFIER_COOKIE = "oidc_verifier";

// Short-lived, httpOnly cookies just for the duration of the OAuth
// round-trip (login -> IdP -> callback).
const flowCookieOpts = {
  httpOnly: true,
  sameSite: "lax" as const,
  maxAge: 10 * 60 * 1000,
};

router.get("/login", async (req, res, next) => {
  try {
    const config = await getOidcConfig();

    const code_verifier = client.randomPKCECodeVerifier();
    const code_challenge = await client.calculatePKCECodeChallenge(code_verifier);
    const state = client.randomState();

    const redirectTo = client.buildAuthorizationUrl(config, {
      redirect_uri: REDIRECT_URI,
      scope: "openid profile email",
      code_challenge,
      code_challenge_method: "S256",
      state,
    });

    res.cookie(STATE_COOKIE, state, flowCookieOpts);
    res.cookie(VERIFIER_COOKIE, code_verifier, flowCookieOpts);
    res.redirect(redirectTo.href);
  } catch (err) {
    next(err);
  }
});

router.get("/callback", async (req, res, next) => {
  try {
    const expectedState = req.cookies?.[STATE_COOKIE];
    const pkceCodeVerifier = req.cookies?.[VERIFIER_COOKIE];
    res.clearCookie(STATE_COOKIE);
    res.clearCookie(VERIFIER_COOKIE);

    if (!expectedState || !pkceCodeVerifier) {
      return res.status(400).json({ error: "Missing OIDC flow cookies" });
    }

    const config = await getOidcConfig();
    const currentUrl = new URL(
      req.originalUrl,
      `${req.protocol}://${req.get("host")}`,
    );

    const tokens = await client.authorizationCodeGrant(config, currentUrl, {
      pkceCodeVerifier,
      expectedState,
    });

    const claims = tokens.claims() as
      | (client.IDToken & {
          email?: string;
          name?: string;
          is_super_admin?: boolean;
        })
      | undefined;
    if (!claims) {
      return res.status(400).json({ error: "No ID token returned" });
    }

    const isSuperAdmin = claims.is_super_admin === true;

    const user = await prisma.user.upsert({
      where: { oidcSub: claims.sub },
      update: {
        email: claims.email as string,
        name: claims.name ?? null,
        isSuperAdmin,
      },
      create: {
        oidcSub: claims.sub,
        email: claims.email as string,
        name: claims.name ?? null,
        isSuperAdmin,
      },
    });

    const sessionToken = signSession(user.id);
    res.cookie(SESSION_COOKIE, sessionToken, {
      httpOnly: true,
      sameSite: "lax",
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });

    res.redirect(FRONTEND_URL);
  } catch (err) {
    next(err);
  }
});

router.get("/logout", (_req, res) => {
  res.clearCookie(SESSION_COOKIE);
  res.redirect(`${FRONTEND_URL}/login`);
});

export default router;
