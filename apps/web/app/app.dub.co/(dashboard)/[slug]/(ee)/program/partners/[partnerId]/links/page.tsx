"use client";

import { usePartnerReferral } from "@/lib/partner-referrals/hooks/use-partner-referral";
import { constructPartnerReferralLink } from "@/lib/partner-referrals/utils";
import { constructPartnerLink } from "@/lib/partners/construct-partner-link";
import useGroup from "@/lib/swr/use-group";
import usePartner from "@/lib/swr/use-partner";
import useProgram from "@/lib/swr/use-program";
import useWorkspace from "@/lib/swr/use-workspace";
import { EnrolledPartnerProps } from "@/lib/types";
import { useAddPartnerLinkModal } from "@/ui/modals/add-partner-link-modal";
import {
  Button,
  CopyButton,
  LoadingSpinner,
  Table,
  useTable,
} from "@dub/ui";
import { cn, currencyFormatter, getPrettyUrl, nFormatter } from "@dub/utils";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useMemo } from "react";

export default function ProgramPartnerLinksPage() {
  const { partnerId } = useParams() as { partnerId: string };
  const { partner, error } = usePartner({ partnerId });

  return partner ? (
    <div className="grid min-w-0 gap-4">
      <PartnerLinks partner={partner} />
      <PartnerReferralLink partner={partner} />
    </div>
  ) : (
    <div className="flex justify-center py-16">
      {error ? (
        <span className="text-content-subtle text-sm">
          Failed to load partner links
        </span>
      ) : (
        <LoadingSpinner />
      )}
    </div>
  );
}

const PartnerLinks = ({ partner }: { partner: EnrolledPartnerProps }) => {
  const { slug } = useWorkspace();

  const { group } = useGroup({
    groupIdOrSlug: partner.groupId ?? undefined,
  });

  const { AddPartnerLinkModal, setShowAddPartnerLinkModal } =
    useAddPartnerLinkModal({
      partner,
    });

  const table = useTable({
    data: partner.links || [],
    columns: [
      {
        id: "shortLink",
        header: "Link",
        meta: {
          disableTruncate: true,
        },
        cell: ({ row }) => {
          const partnerLink = constructPartnerLink({
            group: group ?? undefined,
            link: row.original,
          });
          return (
            <div className="flex items-center gap-3">
              <Link
                href={`/${slug}/links/${row.original.domain}/${row.original.key}`}
                target="_blank"
                className="cursor-alias font-medium text-black decoration-dotted hover:underline"
              >
                {getPrettyUrl(partnerLink)}
              </Link>
              <CopyButton value={partnerLink} className="p-0.5" />
            </div>
          );
        },
      },
      {
        header: "Clicks",
        size: 1,
        minSize: 1,
        cell: ({ row }) => (
          <Link
            href={`/${slug}/events?event=clicks&interval=all&domain=${row.original.domain}&key=${row.original.key}`}
            target="_blank"
            className="block w-full cursor-alias decoration-dotted hover:underline"
          >
            {nFormatter(row.original.clicks)}
          </Link>
        ),
      },
      {
        header: "Leads",
        size: 1,
        minSize: 1,
        cell: ({ row }) => (
          <Link
            href={`/${slug}/events?event=leads&interval=all&domain=${row.original.domain}&key=${row.original.key}`}
            target="_blank"
            className="block w-full cursor-alias decoration-dotted hover:underline"
          >
            {nFormatter(row.original.leads)}
          </Link>
        ),
      },
      {
        header: "Conversions",
        size: 1,
        minSize: 1,
        cell: ({ row }) => (
          <Link
            href={`/${slug}/events?event=sales&interval=all&domain=${row.original.domain}&key=${row.original.key}`}
            target="_blank"
            className="block w-full cursor-alias decoration-dotted hover:underline"
          >
            {nFormatter(row.original.conversions)}
          </Link>
        ),
      },
      {
        header: "Revenue",
        accessorFn: (d) =>
          currencyFormatter(d.saleAmount, {
            trailingZeroDisplay: "stripIfInteger",
          }),
        size: 1,
        minSize: 1,
        cell: ({ row }) => (
          <Link
            href={`/${slug}/events?event=sales&interval=all&domain=${row.original.domain}&key=${row.original.key}`}
            target="_blank"
            className="block w-full cursor-alias decoration-dotted hover:underline"
          >
            {currencyFormatter(row.original.saleAmount, {
              trailingZeroDisplay: "stripIfInteger",
            })}
          </Link>
        ),
      },
    ],
    resourceName: (p) => `link${p ? "s" : ""}`,
    thClassName: (id) =>
      cn(id === "total" && "[&>div]:justify-end", "border-l-0"),
    tdClassName: (id) => cn(id === "total" && "text-right", "border-l-0"),
    className: "[&_tr:last-child>td]:border-b-transparent",
    containerClassName: "w-full max-w-full overflow-hidden",
    scrollWrapperClassName: "min-h-[40px] max-w-full",
  } as any);

  return (
    <>
      <div className="flex items-end justify-between gap-4">
        <h2 className="text-content-emphasis text-lg font-semibold">
          Referral links
        </h2>
        <Button
          variant="secondary"
          text="Create link"
          className="h-8 w-fit rounded-lg px-3 py-2 font-medium"
          onClick={() => setShowAddPartnerLinkModal(true)}
        />
      </div>
      <Table {...table} />
      <AddPartnerLinkModal />
    </>
  );
};

const PartnerReferralLink = ({
  partner,
}: {
  partner: EnrolledPartnerProps;
}) => {
  const { slug } = useWorkspace();
  const router = useRouter();
  const {
    program,
    loading: loadingProgram,
    error: errorProgram,
  } = useProgram();
  const {
    referral,
    loading: loadingReferral,
    error: referralError,
  } = usePartnerReferral({
    partnerId: partner.id,
  });

  const referralLink = constructPartnerReferralLink({
    partner,
    program,
  });

  const data = useMemo(() => {
    if (!referralLink || !referral?.stats) {
      return [];
    }

    return [
      {
        link: referralLink,
        totalPartners: referral.stats.totalPartners,
        totalConversions: referral.stats.totalConversions,
        totalSaleAmount: referral.stats.totalSaleAmount,
      },
    ];
  }, [referralLink, referral]);

  const referredPartnersUrl = `/${slug}/program/partners?referredByPartnerId=${partner.id}`;

  const table = useTable({
    data,
    columns: [
      {
        id: "link",
        header: "Link",
        cell: ({ row }) => (
          <div className="flex items-center gap-3">
            <span className="font-medium text-black">
              {getPrettyUrl(row.original.link)}
            </span>
            <CopyButton value={row.original.link} className="p-0.5" />
          </div>
        ),
      },
      {
        header: "Partners",
        size: 1,
        minSize: 1,
        cell: ({ row }) => nFormatter(row.original.totalPartners),
      },
      {
        header: "Conversions",
        size: 1,
        minSize: 1,
        cell: ({ row }) => nFormatter(row.original.totalConversions),
      },
      {
        header: "Revenue",
        size: 1,
        minSize: 1,
        cell: ({ row }) =>
          currencyFormatter(row.original.totalSaleAmount, {
            trailingZeroDisplay: "stripIfInteger",
          }),
      },
    ],
    onRowClick: (_row, e) => {
      if (e.metaKey || e.ctrlKey) window.open(referredPartnersUrl, "_blank");
      else router.push(referredPartnersUrl);
    },
    onRowAuxClick: () => window.open(referredPartnersUrl, "_blank"),
    rowProps: () => ({
      onPointerEnter: () => router.prefetch(referredPartnersUrl),
    }),
    resourceName: (p) => `link${p ? "s" : ""}`,
    thClassName: (id) =>
      cn(id === "total" && "[&>div]:justify-end", "border-l-0"),
    tdClassName: (id) => cn(id === "total" && "text-right", "border-l-0"),
    className: "[&_tr:last-child>td]:border-b-transparent",
    scrollWrapperClassName: "min-h-[40px]",
    loading: loadingReferral || loadingProgram,
    error:
      referralError || errorProgram
        ? "Failed to load partner referral data"
        : undefined,
  });

  if (!partner?.referralRewardId) {
    return null;
  }

  return (
    <>
      <h2 className="text-content-emphasis text-lg font-semibold">
        Partner referral link
      </h2>
      <Table {...table} />
    </>
  );
};
