import { createHash, randomBytes } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";

// Hand-rolled OIDC relying-party client against the SpaceMarvel dashboard —
// mirrors ChatPlatform-backend's oidc_client.py / oidc_verify.py exactly
// (same endpoints derived from the issuer, same PKCE generation, same
// authorization_code + PKCE token exchange, same RS256/JWKS id_token
// verification with issuer checked and audience left unenforced by default,
// matching that reference implementation's own default OIDC_AUDIENCE="").
const ISSUER = process.env.OIDC_SPACEMARVEL_ISSUER!;
const CLIENT_ID = process.env.OIDC_SPACEMARVEL_CLIENT_ID!;
const CLIENT_SECRET = process.env.OIDC_SPACEMARVEL_CLIENT_SECRET!;
const SCOPE = "openid profile email";

export const AUTHORIZE_URL = `${ISSUER}/authorize/`;
const TOKEN_URL = `${ISSUER}/token/`;
const JWKS_URL = `${ISSUER}/.well-known/jwks.json`;

let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;
function getJwks() {
  if (!jwks) jwks = createRemoteJWKSet(new URL(JWKS_URL));
  return jwks;
}

export function generatePkce() {
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function generateState() {
  return randomBytes(24).toString("base64url");
}

export function buildAuthorizeUrl({
  redirectUri,
  state,
  codeChallenge,
}: {
  redirectUri: string;
  state: string;
  codeChallenge: string;
}) {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: redirectUri,
    scope: SCOPE,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    // Without this, the dashboard sees an existing session cookie and skips
    // straight past its login screen, silently reusing whatever account is
    // currently active there — "Continue with SpaceMarvel" would never
    // actually ask. Forces re-authentication every time instead. (Dropped
    // once earlier while chasing a NextAuth state-cookie bug — that flow is
    // gone now, replaced by this Domain-scoped cookie OIDC client, so the
    // extra hop this adds is no longer the fragile point it used to be.)
    prompt: "login",
  });
  return `${AUTHORIZE_URL}?${params}`;
}

export async function exchangeCodeForTokens({
  code,
  codeVerifier,
  redirectUri,
}: {
  code: string;
  codeVerifier: string;
  redirectUri: string;
}) {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      code_verifier: codeVerifier,
    }),
  });

  if (!res.ok) {
    throw new Error(
      `OIDC token exchange failed (${res.status}): ${await res.text()}`,
    );
  }

  return res.json() as Promise<{
    id_token: string;
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  }>;
}

export interface OidcProfile {
  sub: string;
  email: string;
  name?: string;
  is_super_admin?: boolean;
}

export async function verifyIdToken(idToken: string): Promise<OidcProfile> {
  const { payload } = await jwtVerify(idToken, getJwks(), {
    issuer: ISSUER,
  });
  return payload as unknown as OidcProfile;
}
