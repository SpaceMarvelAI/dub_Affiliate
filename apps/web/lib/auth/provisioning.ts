import { createWorkspaceId } from "@/lib/api/workspaces/create-workspace-id";
import { generateRandomString } from "@/lib/api/utils/generate-random-string";
import { prisma } from "@/lib/prisma";
import { createId } from "../api/create-id";

// Unchanged from the old NextAuth `jwt` callback (lib/auth/options.ts) — just
// moved here so both the OIDC callback route and anything else that needs it
// can call it directly, now that there's no NextAuth callback to host it in.
const ADMIN_WORKSPACE_SLUG = "spacemarvel-affiliate";

export const ensureAdminWorkspace = async (userId: string) => {
  let workspace = await prisma.project.findUnique({
    where: { slug: ADMIN_WORKSPACE_SLUG },
    select: { id: true },
  });

  if (!workspace) {
    workspace = await prisma.project.create({
      data: {
        id: createWorkspaceId(),
        name: "SpaceMarvel Affiliate",
        slug: ADMIN_WORKSPACE_SLUG,
        billingCycleStart: new Date().getDate(),
        invoicePrefix: generateRandomString(8),
      },
      select: { id: true },
    });
  }

  await prisma.projectUsers.upsert({
    where: {
      userId_projectId: {
        userId,
        projectId: workspace.id,
      },
    },
    update: {},
    create: {
      userId,
      projectId: workspace.id,
      role: "owner",
      notificationPreference: { create: {} },
    },
  });
};

export const ensurePartnerAccount = async ({
  userId,
  email,
  name,
}: {
  userId: string;
  email: string;
  name?: string | null;
}) => {
  const partner = await prisma.partner.upsert({
    where: { email },
    update: {},
    create: {
      id: createId({ prefix: "pn_" }),
      name: name || email,
      email,
    },
    select: { id: true },
  });

  await prisma.partnerUser.upsert({
    where: {
      userId_partnerId: {
        userId,
        partnerId: partner.id,
      },
    },
    update: {},
    create: {
      userId,
      partnerId: partner.id,
      role: "owner",
      notificationPreferences: { create: {} },
    },
  });

  // Without this, a user who's never explicitly chosen a default partner
  // (or gone through a separate onboarding flow that sets one) has NO
  // defaultPartnerId at all even after the upserts above create their
  // Partner/PartnerUser rows — every partner-scoped API 404s "not_found"
  // forever, with no default to fall back to. updateMany + defaultPartnerId:
  // null keeps this idempotent and never clobbers a value they've since set.
  await prisma.user.updateMany({
    where: { id: userId, defaultPartnerId: null },
    data: { defaultPartnerId: partner.id },
  });
};
