import { jwtVerify, SignJWT } from "jose";

// Our own session token — same idea as ChatPlatform-backend's jwt_service.py
// (HS256, one shared secret, claims embedded directly), except this is
// delivered via an httpOnly cookie instead of a bearer header: dub_Affiliate
// is server-rendered (middleware/getServerSession need to read the session
// before any client JS runs), which only a cookie can do. Reuses
// NEXTAUTH_SECRET as the signing key — it's already a proper random secret
// and NextAuth itself no longer reads it.
export const SESSION_COOKIE = "sm_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

function getSecretKey() {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) {
    throw new Error(
      "NEXTAUTH_SECRET is not set — required to sign/verify the session token",
    );
  }
  return new TextEncoder().encode(secret);
}

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  image?: string | null;
  isMachine: boolean;
  isSuperAdmin: boolean;
  defaultWorkspace?: string | null;
  defaultPartnerId?: string | null;
}

export async function signSessionToken(user: SessionUser) {
  return new SignJWT({ user })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE}s`)
    .sign(getSecretKey());
}

export async function verifySessionToken(
  token: string,
): Promise<SessionUser | null> {
  try {
    const { payload } = await jwtVerify(token, getSecretKey());
    return (payload.user as SessionUser) ?? null;
  } catch {
    return null;
  }
}

// Short-lived, single-purpose handoff token — carries a signed-in user's
// claims across a host boundary (localhost:3000 -> partners.localhost:3000)
// in the redirect URL instead of a cookie. Only needed because Domain=
// localhost cookies aren't reliably shared across *.localhost subdomains in
// real browsers, and Google's OAuth console won't accept partners.localhost
// as a redirect URI at all — so the OAuth round trip runs on one host and
// the resulting session has to be handed off to the real target host. 60s
// expiry keeps the exposure window (it's in a URL) tiny; the `type` claim
// stops it being reused as if it were a real session token.
export async function signHandoffToken(user: SessionUser) {
  return new SignJWT({ user, type: "handoff" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime("60s")
    .sign(getSecretKey());
}

export async function verifyHandoffToken(
  token: string,
): Promise<SessionUser | null> {
  try {
    const { payload } = await jwtVerify(token, getSecretKey());
    if (payload.type !== "handoff") return null;
    return (payload.user as SessionUser) ?? null;
  } catch {
    return null;
  }
}
