import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth/jwt";
import { UserProps } from "@/lib/types";
import { NextRequest } from "next/server";

export async function getUserViaToken(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return undefined;
  return (await verifySessionToken(token)) as UserProps | undefined;
}
