import { SessionUser } from "../middleware/auth";
import { prisma } from "./prisma";

// Auto-provision a Partner row for a user on first use — mirrors the
// auto-provisioning pattern in apps/web (lib/auth/options.ts, ensurePartnerAccount).
export async function getOrCreatePartner(user: SessionUser) {
  const existing = await prisma.partner.findUnique({
    where: { userId: user.id },
  });
  if (existing) return existing;

  return prisma.partner.create({
    data: {
      userId: user.id,
      name: user.name || user.email,
      email: user.email,
    },
  });
}
