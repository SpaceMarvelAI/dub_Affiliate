import { Router } from "express";
import { randomKey } from "../lib/key";
import { getOrCreatePartner } from "../lib/partner";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";

const router = Router();

router.get("/", requireAuth, async (req, res) => {
  const partner = await getOrCreatePartner(req.user!);
  const links = await prisma.link.findMany({
    where: { partnerId: partner.id },
    orderBy: { createdAt: "desc" },
  });
  res.json(links);
});

router.post("/", requireAuth, async (req, res) => {
  const { url, key } = req.body as { url?: string; key?: string };
  if (!url) {
    return res.status(400).json({ error: "url is required" });
  }

  const partner = await getOrCreatePartner(req.user!);

  // Exactly one Program row is expected to exist in practice (MVP has no
  // multi-program UI) — see spec.
  const program = await prisma.program.findFirst();
  if (!program) {
    return res.status(500).json({ error: "No program configured" });
  }

  let finalKey = key;
  if (finalKey) {
    const collision = await prisma.link.findUnique({
      where: { key: finalKey },
    });
    if (collision) {
      return res.status(409).json({ error: "key already in use" });
    }
  } else {
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = randomKey();
      const collision = await prisma.link.findUnique({
        where: { key: candidate },
      });
      if (!collision) {
        finalKey = candidate;
        break;
      }
    }
    if (!finalKey) {
      return res.status(500).json({ error: "Could not generate a unique key" });
    }
  }

  const link = await prisma.link.create({
    data: {
      partnerId: partner.id,
      programId: program.id,
      key: finalKey,
      url,
    },
  });

  res.status(201).json(link);
});

export default router;
