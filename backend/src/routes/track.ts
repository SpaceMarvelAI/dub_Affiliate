import { Router } from "express";
import { requireTrackSecret } from "../middleware/trackAuth";
import { prisma } from "../lib/prisma";

const router = Router();

router.post("/sale", requireTrackSecret, async (req, res) => {
  const { customerExternalId, amount, currency, invoiceId, linkKey } =
    req.body as {
      customerExternalId?: string;
      amount?: number;
      currency?: string;
      invoiceId?: string;
      linkKey?: string;
    };

  if (!customerExternalId || typeof amount !== "number") {
    return res
      .status(400)
      .json({ error: "customerExternalId and amount are required" });
  }

  const customer = await prisma.customer.upsert({
    where: { externalId: customerExternalId },
    update: {},
    create: { externalId: customerExternalId },
  });

  if (invoiceId) {
    const existing = await prisma.commission.findUnique({
      where: { invoiceId },
    });
    if (existing) {
      return res.json({ customer, commission: existing });
    }
  }

  if (!linkKey) {
    // No link to attribute this sale to a partner — nothing to commission.
    return res.json({ customer, commission: null });
  }

  const link = await prisma.link.findUnique({
    where: { key: linkKey },
    include: { program: true },
  });
  if (!link) {
    return res.json({ customer, commission: null });
  }

  const commissionAmount = Math.round(
    (amount * Number(link.program.commissionPercent)) / 100,
  );

  const commission = await prisma.commission.create({
    data: {
      partnerId: link.partnerId,
      linkId: link.id,
      customerId: customer.id,
      amount: commissionAmount,
      currency: currency || "usd",
      invoiceId: invoiceId || null,
      status: "pending",
    },
  });

  res.json({ customer, commission });
});

export default router;
