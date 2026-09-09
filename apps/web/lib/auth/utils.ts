import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { randomInt } from "node:crypto";
import { DubApiError } from "../api/errors";
import { SESSION_COOKIE, verifySessionToken } from "./jwt";

export interface Session {
  user: {
    id: string;
    name: string;
    email: string;
    image?: string;
    isMachine: boolean;
    isSuperAdmin: boolean;
    defaultWorkspace?: string;
    defaultPartnerId?: string;
  };
}

// Reads and verifies our own session cookie (see lib/auth/jwt.ts) — replaces
// NextAuth's getServerSession(authOptions). Same Session shape as before, so
// every existing caller (withSession, server components, etc.) needs no
// changes.
export const getSession = async () => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null as unknown as Session;
  const user = await verifySessionToken(token);
  if (!user) return null as unknown as Session;
  return { user } as Session;
};

export const getAuthTokenOrThrow = (
  req: Request | NextRequest,
  type: "Bearer" | "Basic" = "Bearer",
) => {
  const authorizationHeader = req.headers.get("Authorization");

  if (!authorizationHeader) {
    throw new DubApiError({
      code: "bad_request",
      message:
        "Misconfigured authorization header. Did you forget to add 'Bearer '? Learn more: https://d.to/auth",
    });
  }

  return authorizationHeader.replace(`${type} `, "");
};

export function generateOTP() {
  const randomNumber = randomInt(0, 1000000);

  // Pad the number with leading zeros if necessary to ensure it is always 6 digits
  return randomNumber.toString().padStart(6, "0");
}
