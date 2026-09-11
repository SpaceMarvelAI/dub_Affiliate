import { trackSaleForCustomer } from "@/lib/api/conversions/track-sale";
import { createId } from "@/lib/api/create-id";
import { getOrCreateCustomer } from "@/lib/api/customers/get-or-create-customer";
import { DubApiError } from "@/lib/api/errors";
import { parseRequestBody } from "@/lib/api/utils";
import { withWorkspace } from "@/lib/auth";
import { generateRandomName } from "@/lib/names";
import { prisma } from "@/lib/prisma";
import { LeadEventTB } from "@/lib/types";
import { nanoid } from "@dub/utils";
import { NextResponse } from "next/server";
import * as z from "zod/v4";

// POST /api/track/redeem-code – Track a sale for a partner's own code
// (typed at checkout, e.g. on SpaceMarvel's own payment page), not a link
// someone clicked. /api/track/sale requires either an existing Customer or
// a real prior Tinybird click event to attribute a sale to a partner — a
// manually-entered code has neither, so this bypasses that requirement:
// look the partner's link/code up directly, synthesize the minimal
// click/lead-shaped data trackSaleForCustomer() needs, and let it run the
// exact same Reward → Commission pipeline a real click-through sale uses.
const redeemCodeRequestSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1, "code is required")
    .describe("The partner's short code (their link's key)."),
  customerExternalId: z
    .string()
    .trim()
    .min(1, "customerExternalId is required")
    .max(100)
    .describe("The unique ID of the paying customer in your system."),
  amount: z
    .number()
    .int()
    .positive()
    .describe("The sale amount, in cents."),
  currency: z.string().trim().default("usd"),
  invoiceId: z
    .string()
    .trim()
    .nullish()
    .describe("Your invoice/order ID — used to make repeat calls idempotent."),
  metadata: z.record(z.string(), z.any()).nullish(),
});

export const POST = withWorkspace(
  async ({ req, workspace }) => {
    const body = await parseRequestBody(req);
    const { code, customerExternalId, amount, currency, invoiceId, metadata } =
      redeemCodeRequestSchema.parse(body);

    // Scoped to this workspace's own links — codes only need to be unique
    // within one workspace's set of links, not globally (Link's actual
    // uniqueness constraint is per-domain, but a workspace only ever hands
    // out codes on its own domain(s)).
    const link = await prisma.link.findFirst({
      where: { projectId: workspace.id, key: code },
      select: {
        id: true,
        url: true,
        domain: true,
        key: true,
        programId: true,
        partnerId: true,
        disabledAt: true,
      },
    });

    if (!link) {
      throw new DubApiError({
        code: "not_found",
        message: `No code found matching "${code}".`,
      });
    }
    if (link.disabledAt) {
      throw new DubApiError({
        code: "not_found",
        message: `Code "${code}" is disabled.`,
      });
    }
    if (!link.programId || !link.partnerId) {
      throw new DubApiError({
        code: "bad_request",
        message: `Code "${code}" isn't a partner code — nothing to credit.`,
      });
    }

    const { customer } = await getOrCreateCustomer({
      where: {
        projectId_externalId: {
          projectId: workspace.id,
          externalId: customerExternalId,
        },
      },
      create: {
        id: createId({ prefix: "cus_" }),
        name: generateRandomName(),
        externalId: customerExternalId,
        linkId: link.id,
        projectId: workspace.id,
        clickedAt: new Date(),
      },
    });

    // Minimal click/lead-shaped record — trackSaleForCustomer() only reads
    // link_id/workspace_id/customer_id/event_* off this plus a handful of
    // analytics fields it just passes through to the Tinybird sale record;
    // there's no real click, so those are left null/empty rather than
    // invented.
    const leadEventData: LeadEventTB = {
      click_id: `redeem_${nanoid(16)}`,
      link_id: link.id,
      workspace_id: workspace.id,
      domain: link.domain,
      key: link.key,
      url: link.url,
      continent: null,
      country: null,
      region: null,
      city: null,
      latitude: null,
      longitude: null,
      device: null,
      device_model: null,
      device_vendor: null,
      browser: null,
      browser_version: null,
      os: null,
      os_version: null,
      trigger: null,
      engine: null,
      engine_version: null,
      cpu_architecture: null,
      ua: null,
      bot: null,
      referer: null,
      referer_url: null,
      ip: null,
      qr: null,
      event_id: `redeem_${nanoid(16)}`,
      event_name: "Code redeemed",
      customer_id: customer.id,
      metadata: metadata ? JSON.stringify(metadata) : "",
    } as LeadEventTB;

    const response = await trackSaleForCustomer({
      amount,
      currency,
      eventName: "Purchase",
      paymentProcessor: "custom",
      invoiceId: invoiceId ?? undefined,
      metadata,
      workspace,
      leadEventData,
      customer,
      source: "tracked",
    });

    return NextResponse.json(response);
  },
  {
    requiredPlan: ["business", "advanced", "enterprise"],
    requiredRoles: ["owner", "member"],
  },
);
