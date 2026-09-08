import { Router } from "express";
import { prisma } from "../lib/prisma";
import { requireAdmin, requireAuth } from "../middleware/auth";

const router = Router();

router.get("/partners", requireAuth, requireAdmin, async (req, res) => {
  const partners = await prisma.partner.findMany({
    include: {
      _count: { select: { links: true } },
      commissions: { select: { amount: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  res.json(
    partners.map(({ commissions, _count, ...partner }) => ({
      ...partner,
      linkCount: _count.links,
      totalCommissionEarned: commissions.reduce((sum, c) => sum + c.amount, 0),
    })),
  );
});

router.get("/commissions", requireAuth, requireAdmin, async (req, res) => {
  const commissions = await prisma.commission.findMany({
    include: { partner: true, customer: true },
    orderBy: { createdAt: "desc" },
  });
  res.json(commissions);
});

export default router;
