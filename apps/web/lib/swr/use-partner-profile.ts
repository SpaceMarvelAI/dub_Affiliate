import { fetcher } from "@dub/utils";
import { useSession } from "next-auth/react";
import useSWR from "swr";
import { getPayoutMethodsForCountry } from "../partners/get-payout-methods-for-country";
import { PartnerBetaFeatures, PartnerProps } from "../types";

interface PartnerProfile extends PartnerProps {
  featureFlags?: Record<PartnerBetaFeatures, boolean>;
}

export default function usePartnerProfile() {
  const { status } = useSession();

  const {
    data: partner,
    error,
    isLoading,
    mutate,
  } = useSWR<PartnerProfile>(
    // Gating on defaultPartnerId itself (rather than just waiting for the
    // session to resolve) meant a user with NO partner profile at all never
    // got a response either way — no data, no error — so the API's own
    // "not_found" 404 (lib/auth/partner.ts) never had a chance to reach the
    // callers that branch on it (e.g. PartnerProfileAuth's redirect to
    // /onboarding), leaving them stuck in a permanent loading state instead.
    status !== "loading" && "/api/partner-profile",
    fetcher,
    {
      dedupingInterval: 60000,
      keepPreviousData: true,
    },
  );

  const platformsVerified = partner?.platforms?.length
    ? Object.fromEntries(
        partner.platforms.map((p) => [p.type, p.verifiedAt != null]),
      )
    : undefined;

  const availablePayoutMethods = getPayoutMethodsForCountry({
    country: partner?.country,
  });

  return {
    partner,
    platformsVerified,
    error,
    loading: status === "loading" || isLoading,
    mutate,
    availablePayoutMethods,
  };
}
