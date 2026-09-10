import { authDebug } from "@/lib/auth/debug-log";
import { SESSION_COOKIE, SESSION_MAX_AGE, signSessionToken } from "@/lib/auth/jwt";
import { LOCKOUT_MINUTES, MAX_LOGIN_ATTEMPTS, verifyPassword } from "@/lib/auth/password";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

const isProd = process.env.NODE_ENV === "production";

// Was hardcoded to ".dub.co" — silently broke every non-dub.co deployment
// (e.g. affiliate.spacemarvel.com): a cookie's Domain attribute must be the
// request's own host or a registrable parent of it, and dub.co isn't a
// parent of spacemarvel.com, so browsers reject the Set-Cookie outright.
// Derive it from the actual request host instead, so it's valid wherever
// this runs. Cross-subdomain sharing only applies to genuine multi-label
// hosts (app.dub.co, affiliate.spacemarvel.com); a bare/apex host gets a
// host-only cookie, which is exactly right for a single-hostname deployment.
function getCookieDomain(host: string | null): string | undefined {
  if (!isProd || !host) return undefined;
  const labels = host.split(":")[0].split(".");
  if (labels.length <= 2) return undefined;
  return `.${labels.slice(-2).join(".")}`;
}

// Same generic message for "no such account", "no password set" (they
// signed up via Google), and "wrong password" — don't let a login form
// reveal which of the three it was.
const INVALID = { error: "Incorrect email or password." };

export async function POST(req: NextRequest) {
  const { email, password } = await req.json().catch(() => ({}));
  if (typeof email !== "string" || typeof password !== "string") {
    return NextResponse.json(INVALID, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      name: true,
      email: true,
      image: true,
      isMachine: true,
      isSuperAdmin: true,
      defaultWorkspace: true,
      defaultPartnerId: true,
      passwordHash: true,
      invalidLoginAttempts: true,
      lockedAt: true,
    },
  });

  if (!user || !user.passwordHash) {
    return NextResponse.json(INVALID, { status: 401 });
  }

  if (user.lockedAt) {
    const unlocksAt = user.lockedAt.getTime() + LOCKOUT_MINUTES * 60_000;
    if (Date.now() < unlocksAt) {
      return NextResponse.json(
        { error: `Too many failed attempts. Try again in ${LOCKOUT_MINUTES} minutes.` },
        { status: 429 },
      );
    }
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    const attempts = user.invalidLoginAttempts + 1;
    await prisma.user.update({
      where: { id: user.id },
      data: {
        invalidLoginAttempts: attempts,
        lockedAt: attempts >= MAX_LOGIN_ATTEMPTS ? new Date() : undefined,
      },
    });
    return NextResponse.json(INVALID, { status: 401 });
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { invalidLoginAttempts: 0, lockedAt: null },
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
  authDebug("session", "Password login complete, session token issued", { userId: user.id });

  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
    secure: isProd,
    domain: getCookieDomain(req.headers.get("host")),
  });
  return res;
}
