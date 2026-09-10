import { createId } from "@/lib/api/create-id";
import { authDebug } from "@/lib/auth/debug-log";
import { SESSION_COOKIE, SESSION_MAX_AGE, signSessionToken } from "@/lib/auth/jwt";
import { hashPassword } from "@/lib/auth/password";
import { isBlacklistedEmail } from "@/lib/edge-config";
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

export async function POST(req: NextRequest) {
  const { email, password, name } = await req.json().catch(() => ({}));

  if (typeof email !== "string" || typeof password !== "string") {
    return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json(
      { error: "Password must be at least 8 characters." },
      { status: 400 },
    );
  }
  if (await isBlacklistedEmail(email)) {
    return NextResponse.json({ error: "This email can't be used." }, { status: 400 });
  }

  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true, passwordHash: true },
  });
  if (existing) {
    // Don't reveal whether the account exists via OAuth only vs a real
    // password conflict — same generic message either way.
    return NextResponse.json(
      { error: "An account with this email already exists." },
      { status: 409 },
    );
  }

  const passwordHash = await hashPassword(password);
  const user = await prisma.user.create({
    data: {
      id: createId({ prefix: "user_" }),
      email,
      name: name || email,
      passwordHash,
      notificationPreferences: { create: {} },
    },
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
    ...user,
    name: user.name || "",
    email: user.email || "",
  });
  authDebug("session", "Signup complete, session token issued", { userId: user.id });

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
