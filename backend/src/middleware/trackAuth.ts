import { NextFunction, Request, Response } from "express";

const TRACK_API_SECRET = process.env.TRACK_API_SECRET!;

export function requireTrackSecret(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const header = req.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token || token !== TRACK_API_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}
