import { NextFunction, Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { SESSION_COOKIE, verifySession } from "../lib/session";

export type SessionUser = {
  id: string;
  email: string;
  name: string | null;
  isSuperAdmin: boolean;
};

declare global {
  namespace Express {
    interface Request {
      user?: SessionUser;
    }
  }
}

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const token = req.cookies?.[SESSION_COOKIE];
  const payload = token ? verifySession(token) : null;
  if (!payload) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  // Fetched fresh each request (not cached in the JWT) so isSuperAdmin
  // stays live if it changes after the session was issued.
  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: { id: true, email: true, name: true, isSuperAdmin: true },
  });
  if (!user) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  req.user = user;
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user?.isSuperAdmin) {
    return res.status(403).json({ error: "Forbidden" });
  }
  next();
}
