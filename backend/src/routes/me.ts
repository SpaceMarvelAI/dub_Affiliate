import { Router } from "express";
import { requireAuth } from "../middleware/auth";

const router = Router();

router.get("/", requireAuth, (req, res) => {
  const { id, email, name, isSuperAdmin } = req.user!;
  res.json({ id, email, name, isSuperAdmin });
});

export default router;
