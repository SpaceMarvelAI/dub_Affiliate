import { Router } from "express";
import { prisma } from "../lib/prisma";

const router = Router();

router.get("/:key", async (req, res) => {
  const link = await prisma.link.findUnique({ where: { key: req.params.key } });
  if (!link) {
    return res.status(404).json({ error: "Not found" });
  }

  await prisma.$transaction([
    prisma.click.create({
      data: {
        linkId: link.id,
        ip: req.ip,
        referrer: req.get("referer") ?? null,
        userAgent: req.get("user-agent") ?? null,
      },
    }),
    prisma.link.update({
      where: { id: link.id },
      data: { clicksCount: { increment: 1 } },
    }),
  ]);

  res.redirect(302, link.url);
});

export default router;
