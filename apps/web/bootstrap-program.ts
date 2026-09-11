import { createId } from "@/lib/api/create-id";
import { prisma } from "@/lib/prisma";
import { DEFAULT_PARTNER_GROUP } from "@/lib/zod/schemas/groups";

const WORKSPACE_ID = "ws_1M20T40QF5X9HTR8KHAF2XY6F"; // spacemarvel-affiliate (business plan)
const CODE_DOMAIN = "affiliate.spacemarvel.com"; // internal identifier only — codes are typed, never clicked as a URL

async function main() {
  const existing = await prisma.program.findFirst({ where: { workspaceId: WORKSPACE_ID } });
  if (existing) {
    console.log("Program already exists, aborting:", existing.id);
    return;
  }

  const programId = createId({ prefix: "prog_" });
  const defaultGroupId = createId({ prefix: "grp_" });
  const folderId = createId({ prefix: "fold_" });
  const rewardId = createId({ prefix: "rw_" });

  const result = await prisma.$transaction(async (tx) => {
    const folder = await tx.folder.upsert({
      where: { name_projectId: { name: "Partner Links", projectId: WORKSPACE_ID } },
      update: {},
      create: { id: folderId, name: "Partner Links", projectId: WORKSPACE_ID, accessLevel: "write" },
    });

    const program = await tx.program.create({
      data: {
        id: programId,
        workspaceId: WORKSPACE_ID,
        name: "SpaceMarvel Affiliate",
        slug: "spacemarvel-affiliate",
        domain: CODE_DOMAIN,
        defaultFolderId: folder.id,
        defaultGroupId,
        payoutMode: "external",
        rewards: {
          create: { id: rewardId, event: "sale", type: "percentage", amountInPercentage: 15 },
        },
      },
    });

    await tx.partnerGroup.create({
      data: {
        id: defaultGroupId,
        programId,
        slug: DEFAULT_PARTNER_GROUP.slug,
        name: DEFAULT_PARTNER_GROUP.name,
        saleRewardId: rewardId,
        maxPartnerLinks: 10,
        partnerGroupDefaultLinks: {
          create: { id: createId({ prefix: "pgdl_" }), programId, domain: CODE_DOMAIN, url: `https://${CODE_DOMAIN}` },
        },
      },
    });

    await tx.project.update({
      where: { id: WORKSPACE_ID },
      data: { defaultProduct: "program", defaultProgramId: program.id },
    });

    return program;
  });

  console.log("Created program:", JSON.stringify(result, null, 2));

  // Enroll the existing test partner (manjit.naskar@spacemarvel.ai) so there's
  // something real to verify against end to end.
  const partnerUser = await prisma.partnerUser.findFirst({
    where: { user: { email: "manjit.naskar@spacemarvel.ai" } },
    select: { partnerId: true, partner: { select: { name: true } } },
  });

  if (partnerUser) {
    const enrollmentId = createId({ prefix: "pge_" });
    await prisma.programEnrollment.create({
      data: {
        id: enrollmentId,
        partnerId: partnerUser.partnerId,
        programId,
        groupId: defaultGroupId,
        status: "approved",
      },
    });

    const code = "MANJIT15";
    const linkId = createId({ prefix: "link_" });
    await prisma.link.create({
      data: {
        id: linkId,
        domain: CODE_DOMAIN,
        key: code,
        url: `https://${CODE_DOMAIN}`,
        shortLink: `https://${CODE_DOMAIN}/${code}`,
        projectId: WORKSPACE_ID,
        folderId,
        programId,
        partnerId: partnerUser.partnerId,
      },
    });
    console.log("Enrolled test partner with code:", code);
  } else {
    console.log("No existing test partner found — skipped enrollment.");
  }
}

main().then(() => prisma.$disconnect()).catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
