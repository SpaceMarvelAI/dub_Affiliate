"use client";

import usePartnerPayoutsCount from "@/lib/swr/use-partner-payouts-count";
import { AnimatedSizeContainer, ChevronRight, MoneyBills2 } from "@dub/ui";
import { currencyFormatter } from "@dub/utils";
import { PayoutStatus } from "@prisma/client";
import Link from "next/link";
import { memo } from "react";

export const PayoutStats = memo(() => {
  const { payoutsCount } = usePartnerPayoutsCount({
    groupBy: "status",
  });

  return (
    <AnimatedSizeContainer height>
      <div className="border-border-subtle grid gap-3 border-t p-3">
        <Link
          className="group flex items-center justify-between gap-2"
          href="/payouts"
        >
          <div className="text-content-default flex items-center gap-2 text-sm font-semibold">
            <MoneyBills2 className="size-4" />
            Payouts
          </div>
          <ChevronRight className="text-content-muted group-hover:text-content-default size-3 transition-[color,transform] group-hover:translate-x-0.5 [&_*]:stroke-2" />
        </Link>

        <div className="flex flex-col gap-4">
          <div className="grid gap-1 text-xs">
            <p className="text-content-subtle font-medium">Upcoming payouts</p>
            <div className="flex items-center gap-1">
              {payoutsCount ? (
                <p className="text-content-default font-medium">
                  {currencyFormatter(
                    payoutsCount
                      ?.filter(
                        (payout) =>
                          payout.status === PayoutStatus.pending ||
                          payout.status === PayoutStatus.processing,
                      )
                      ?.reduce((acc, p) => acc + p.amount, 0) || 0,
                  )}
                </p>
              ) : (
                <div className="h-5 w-24 animate-pulse rounded-md bg-neutral-200" />
              )}
            </div>
          </div>
          <div className="grid gap-1 text-xs">
            <p className="text-content-subtle font-medium">Received payouts</p>
            {payoutsCount ? (
              <p className="text-content-default font-medium">
                {currencyFormatter(
                  payoutsCount
                    ?.filter(
                      (payout) =>
                        payout.status === PayoutStatus.processed ||
                        payout.status === PayoutStatus.sent ||
                        payout.status === PayoutStatus.completed,
                    )
                    ?.reduce((acc, p) => acc + p.amount, 0) ?? 0,
                )}
              </p>
            ) : (
              <div className="h-5 w-24 animate-pulse rounded-md bg-neutral-200" />
            )}
          </div>
        </div>
      </div>
    </AnimatedSizeContainer>
  );
});
