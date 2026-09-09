import jwt from "jsonwebtoken";

const SESSION_SECRET = process.env.SESSION_SECRET!;

export const SESSION_COOKIE = "session";

export function signSession(userId: string) {
  return jwt.sign({ sub: userId }, SESSION_SECRET, { expiresIn: "30d" });
}

export function verifySession(token: string): { sub: string } | null {
  try {
    return jwt.verify(token, SESSION_SECRET) as { sub: string };
  } catch {
    return null;
  }
}
