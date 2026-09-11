"use client";

import usePartnerProfile from "@/lib/swr/use-partner-profile";
import useProgramEnrollment from "@/lib/swr/use-program-enrollment";
import useProgramEnrollmentsCount from "@/lib/swr/use-program-enrollments-count";
import { type Icon, useMediaQuery, useRouterStuff } from "@dub/ui";
import {
  Bell,
  CircleDollar,
  Gauge6,
  Gear2,
  GridIcon,
  MoneyBills2,
  ShieldCheck,
  SquareUserSparkle2,
  UserCheck,
  Users2,
  Webhook,
} from "@dub/ui/icons";
import { useParams, usePathname } from "next/navigation";
import { ReactNode, useMemo } from "react";
import { Hyperlink } from "./icons/hyperlink";
import { PartnerProgramDropdown } from "./partner-program-dropdown";
import { PayoutStats } from "./payout-stats";
import { ProgramHelpSupport } from "./program-help-support";
import {
  NavItemType,
  SidebarNav,
  SidebarNavAreas,
  SidebarNavGroups,
} from "./sidebar-nav";

type SidebarNavData = {
  pathname: string;
  queryString?: string;
  isMobile?: boolean;
  programSlug?: string;
  isUnapproved: boolean;
  invitationsCount?: number;
  postbacksEnabled?: boolean;
  newsContent?: ReactNode;
};

const NAV_GROUPS: SidebarNavGroups<SidebarNavData> = ({ pathname }) => [
  {
    name: "Programs",
    description:
      "View all your enrolled programs and review invitations to other programs.",
    icon: GridIcon,
    href: "/programs",
    active: pathname.startsWith("/programs"),
  },
  {
    name: "Payouts",
    description:
      "View all your upcoming and previous payouts for all your programs.",
    icon: MoneyBills2,
    href: "/payouts",
    active: pathname.startsWith("/payouts"),
  },
  {
    name: "Partner profile",
    description:
      "Build a great partner profile and get noticed in our partner network.",
    icon: SquareUserSparkle2,
    href: "/profile",
    active: pathname.startsWith("/profile"),
  },
];

const PROGRAMS_CONTENT = ({
  invitationsCount,
}: {
  invitationsCount?: number;
}): { items: NavItemType[] }[] => [
  {
    items: [
      {
        name: "Programs",
        icon: GridIcon,
        href: "/programs",
        isActive: (pathname, href) =>
          pathname.startsWith(href) && pathname !== "/programs/invitations",
      },
      {
        name: "Invitations",
        icon: UserCheck,
        href: "/programs/invitations",
        badge: invitationsCount || undefined,
      },
    ],
  },
];

const NAV_AREAS: SidebarNavAreas<SidebarNavData> = {
  // Top-level
  programs: ({ invitationsCount }) => ({
    title: <PartnerProgramDropdown />,
    content: PROGRAMS_CONTENT({ invitationsCount }),
    direction: "left",
    showNews: true,
  }),

  profile: ({ postbacksEnabled }) => ({
    title: "Partner profile",
    content: [
      {
        items: [
          {
            name: "Profile",
            icon: SquareUserSparkle2,
            href: "/profile",
            exact: true,
          },
          {
            name: "Members",
            icon: Users2,
            href: "/profile/members",
          },
        ],
      },
      ...(postbacksEnabled
        ? [
            {
              name: "Developer",
              items: [
                {
                  name: "Postbacks",
                  icon: Webhook,
                  href: "/profile/postbacks" as `/${string}`,
                },
              ],
            },
          ]
        : []),
      {
        name: "Account",
        items: [
          {
            name: "Notifications",
            icon: Bell,
            href: "/profile/notifications",
          },
        ],
      },
    ],
    direction: "left",
  }),

  program: ({ programSlug, isUnapproved, queryString }) => ({
    title: <PartnerProgramDropdown />,
    content: [
      {
        items: [
          {
            name: isUnapproved ? "Application" : "Overview",
            icon: isUnapproved ? UserCheck : Gauge6,
            href: `/programs/${programSlug}`,
            exact: true,
          },
          {
            name: "Links",
            icon: Hyperlink as Icon,
            href: `/programs/${programSlug}/links`,
            locked: isUnapproved,
          },
        ],
      },
      {
        name: "Insights",
        items: [
          {
            name: "Earnings",
            icon: CircleDollar,
            href: `/programs/${programSlug}/earnings${queryString}`,
            locked: isUnapproved,
          },
        ],
      },
    ],
  }),

  // User settings
  userSettings: () => ({
    title: "Settings",
    backHref: "/programs",
    content: [
      {
        name: "Account",
        items: [
          {
            name: "General",
            icon: Gear2,
            href: "/account/settings",
            exact: true,
          },
          {
            name: "Security",
            icon: ShieldCheck,
            href: "/account/settings/security",
          },
        ],
      },
    ],
  }),
};

export function PartnersSidebarNav({
  toolContent,
  newsContent,
}: {
  toolContent?: ReactNode;
  newsContent?: ReactNode;
}) {
  const { programSlug } = useParams() as {
    programSlug?: string;
  };
  const pathname = usePathname();
  const { getQueryString } = useRouterStuff();

  const isEnrolledProgramPage =
    pathname.startsWith(`/programs/${programSlug}`) &&
    !["/apply", "/invite"].some((p) => pathname.endsWith(p));

  const { programEnrollment } = useProgramEnrollment({
    enabled: isEnrolledProgramPage,
  });

  const currentArea = useMemo(() => {
    return pathname.startsWith("/account/settings")
      ? "userSettings"
      : pathname.startsWith("/profile")
        ? "profile"
        : pathname.startsWith("/payouts")
          ? null
          : isEnrolledProgramPage
            ? "program"
            : "programs";
  }, [pathname, isEnrolledProgramPage]);

  const { count: invitationsCount } = useProgramEnrollmentsCount({
    status: "invited",
  });

  const isUnapproved = useMemo(
    () =>
      !!programEnrollment &&
      !["approved", "deactivated", "archived"].includes(
        programEnrollment.status,
      ),
    [programEnrollment],
  );

  const { isMobile } = useMediaQuery();

  const { partner } = usePartnerProfile();

  return (
    <SidebarNav
      groups={NAV_GROUPS}
      areas={NAV_AREAS}
      currentArea={currentArea}
      data={{
        pathname,
        queryString: getQueryString(),
        isMobile,
        programSlug: programSlug || "",
        isUnapproved,
        invitationsCount,
        postbacksEnabled: partner?.featureFlags?.postbacks,
        newsContent,
      }}
      toolContent={toolContent}
      newsContent={newsContent}
      bottom={
        isEnrolledProgramPage ? (
          <ProgramHelpSupport />
        ) : (
          <PayoutStats />
        )
      }
    />
  );
}
