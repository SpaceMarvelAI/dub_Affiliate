"use client";

import { hasPermission } from "@/lib/auth/partner-users/partner-user-permissions";
import usePartnerProfile from "@/lib/swr/use-partner-profile";
import { Button, useMediaQuery } from "@dub/ui";
import { usePartnerPayoutSettingsSheet } from "./partner-payout-settings-sheet";

export function PartnerPayoutSettingsButton() {
  const { partner } = usePartnerProfile();

  const { PartnerPayoutSettingsSheet, openSettings } =
    usePartnerPayoutSettingsSheet();

  const { isMobile } = useMediaQuery();

  if (partner && !hasPermission(partner.role, "payout_settings.update")) {
    return null;
  }

  return (
    <>
      <PartnerPayoutSettingsSheet />

      <Button
        type="button"
        text={isMobile ? "Settings" : "Payout settings"}
        variant="secondary"
        className="h-9 px-3"
        onClick={openSettings}
      />
    </>
  );
}
