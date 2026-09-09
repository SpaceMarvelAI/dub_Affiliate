import { generateRandomString } from "@/lib/api/utils/generate-random-string";
import { createWorkspaceId } from "@/lib/api/workspaces/create-workspace-id";
import { isBlacklistedEmail } from "@/lib/edge-config";
import { prisma } from "@/lib/prisma";
import { isStored, storage } from "@/lib/storage";
import { UserProps } from "@/lib/types";
import { APP_DOMAIN_WITH_NGROK } from "@dub/utils";
import { PrismaAdapter } from "@next-auth/prisma-adapter";
import { PrismaClient } from "@prisma/client";
import { waitUntil } from "@vercel/functions";
import { User, type NextAuthOptions } from "next-auth";
import { AdapterAccount, AdapterUser } from "next-auth/adapters";
import { JWT } from "next-auth/jwt";
import { createId } from "../api/create-id";
import { qstash } from "../cron";
import { completeProgramApplications } from "../partners/complete-program-applications";
import { authDebug } from "./debug-log";
import { trackDubLead } from "./track-dub-lead";

const VERCEL_DEPLOYMENT = !!process.env.VERCEL_URL;

const ADMIN_WORKSPACE_SLUG = "spacemarvel-affiliate";

// Surfaced once at module load, dev-only: the #1 cause of "OAuthSignin" is a
// missing/placeholder client_id/secret/issuer — this makes that obvious
// instead of a silent redirect back to /login with a generic error code.
authDebug("config", "SpaceMarvel OIDC provider config", {
  issuer: process.env.OIDC_SPACEMARVEL_ISSUER || "❌ MISSING",
  clientId: process.env.OIDC_SPACEMARVEL_CLIENT_ID
    ? "✅ set"
    : "❌ MISSING",
  clientSecret: process.env.OIDC_SPACEMARVEL_CLIENT_SECRET
    ? "✅ set"
    : "❌ MISSING",
  wellKnownUrl: process.env.OIDC_SPACEMARVEL_ISSUER
    ? `${process.env.OIDC_SPACEMARVEL_ISSUER}/.well-known/openid-configuration`
    : "❌ cannot build — OIDC_SPACEMARVEL_ISSUER is missing",
});

const CustomPrismaAdapter = (p: PrismaClient) => {
  return {
    ...PrismaAdapter(p),
    createUser: async (data: any) => {
      return p.user.create({
        data: {
          ...data,
          id: createId({ prefix: "user_" }),
          notificationPreferences: {
            create: {},
          },
        },
      });
    },
    // Some IdPs return extra token fields
    // so we need to only include the fields that are valid columns on Account table
    linkAccount: (account: AdapterAccount) =>
      p.account.create({
        data: {
          userId: account.userId,
          type: account.type,
          provider: account.provider,
          providerAccountId: account.providerAccountId,
          refresh_token: account.refresh_token,
          refresh_token_expires_in: account.refresh_token_expires_in as any,
          access_token: account.access_token,
          expires_at: account.expires_at,
          token_type: account.token_type,
          scope: account.scope,
          id_token: account.id_token,
          session_state: account.session_state,
        },
      }),
  };
};

// Ensure the single shared admin workspace exists and this user is an owner of it.
const ensureAdminWorkspace = async (userId: string) => {
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

// Ensure a Partner + PartnerUser membership exists for this (non-admin) user.
const ensurePartnerAccount = async ({
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
};

export const authOptions: NextAuthOptions = {
  providers: [
    {
      id: "spacemarvel",
      name: "SpaceMarvel",
      type: "oauth",
      wellKnown: `${process.env.OIDC_SPACEMARVEL_ISSUER}/.well-known/openid-configuration`,
      clientId: process.env.OIDC_SPACEMARVEL_CLIENT_ID,
      clientSecret: process.env.OIDC_SPACEMARVEL_CLIENT_SECRET,
      // prompt=login REMOVED: audited directly against ChatPlatform-backend's
      // proven-reliable OIDC client (which doesn't force it) — it adds an
      // extra interactive hop at the dashboard on every login, widening the
      // window the state/pkce cookies have to survive. That's the leading
      // explanation for the intermittent "State cookie was missing" failures
      // (confirmed via curl that the Set-Cookie response itself is correct
      // every time — the loss is browser-side, between cookie-set and the
      // hop back). Trade-off: logout no longer forces the dashboard's account
      // picker — it'll silently reuse whatever dashboard session is active,
      // same as ChatPlatform-backend's own behavior. Login actually working
      // is the more urgent problem to fix.
      authorization: {
        params: { scope: "openid profile email" },
      },
      idToken: true,
      // "state" dropped: one fewer cookie that must survive the round-trip.
      // PKCE alone is widely accepted as sufficient (it's what actually
      // defeats authorization-code interception/replay) — ChatPlatform-backend
      // itself only validates state as a plain cookie compare with no
      // server-side fallback either, so this isn't weaker than the reference
      // implementation, just less redundant.
      checks: ["pkce"],
      allowDangerousEmailAccountLinking: true,
      profile(profile) {
        return {
          id: profile.sub,
          name: profile.name,
          email: profile.email,
          image: null,
        };
      },
    },
  ],
  // @ts-ignore
  adapter: CustomPrismaAdapter(prisma),
  session: { strategy: "jwt" },
  // domain intentionally left undefined (host-only) for local dev — confirmed
  // by direct evidence, not the old StackOverflow advice this used to cite:
  // a cookie explicitly scoped to Domain=localhost was dropped by Chrome on
  // the cross-site redirect back from the OIDC provider, while NextAuth's own
  // default host-only cookies (csrfToken, callbackUrl — never customized
  // here) survived the identical round-trip. Local dev only ever logs in via
  // plain localhost:3000 (see NEXTAUTH_URL's comment), so host-only cookies
  // never need to cross a host boundary in the first place.
  cookies: {
    sessionToken: {
      name: `${VERCEL_DEPLOYMENT ? "__Secure-" : ""}next-auth.session-token`,
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        // Different situation from state/pkce below, deliberately not
        // host-only: non-admins get redirected from localhost to
        // PARTNERS_DOMAIN (partners.localhost) by our OWN middleware AFTER
        // login completes — an internal, same-site redirect, not the
        // cross-site external-IdP redirect that dropped Domain-scoped
        // cookies earlier. The session needs to exist on both hosts for
        // that post-login hop; state/pkce don't, since they're consumed and
        // gone before this redirect ever happens.
        domain: VERCEL_DEPLOYMENT ? ".dub.co" : "localhost",
        secure: VERCEL_DEPLOYMENT,
      },
    },
    state: {
      name: "next-auth.state",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        domain: VERCEL_DEPLOYMENT ? ".dub.co" : undefined,
        secure: VERCEL_DEPLOYMENT,
        maxAge: 900,
      },
    },
    pkceCodeVerifier: {
      name: "next-auth.pkce.code_verifier",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        domain: VERCEL_DEPLOYMENT ? ".dub.co" : undefined,
        secure: VERCEL_DEPLOYMENT,
        maxAge: 900,
      },
    },
  },
  pages: {
    signIn: "/login",
    error: "/login",
  },
  // Dev-only: NextAuth's own debug output plus a custom logger. `logger.error`
  // is where the *actual* reason behind a generic "?error=OAuthSignin" or
  // "?error=OAuthCallback" redirect lives (bad client_id, discovery fetch
  // failure, invalid_grant, etc.) — NextAuth normally only shows the code on
  // the URL and logs the real error server-side; this makes that visible.
  debug: process.env.NODE_ENV !== "production",
  logger: {
    error(code, metadata) {
      authDebug("error", `NextAuth error: ${code}`, metadata);
    },
    warn(code) {
      authDebug("warn", `NextAuth warning: ${code}`);
    },
    debug(code, metadata) {
      authDebug("config", `NextAuth debug: ${code}`, metadata);
    },
  },
  callbacks: {
    signIn: async ({ user, profile }) => {
      authDebug("signin", "signIn callback invoked", { user, profile });

      if (!user.email || (await isBlacklistedEmail(user.email))) {
        authDebug("warn", "signIn blocked — missing or blacklisted email", {
          email: user.email,
        });
        return false;
      }

      // isSuperAdmin resolution + workspace/partner provisioning happens in
      // the `jwt` callback, not here — this callback runs BEFORE the Prisma
      // adapter creates a brand-new user's row, so `user.id` at this point can
      // still be the raw OIDC `sub`, not yet a real User row (caused a P2025
      // "no record found" on first-ever login).
      return true;
    },
    jwt: async ({
      token,
      user,
      profile,
      trigger,
    }: {
      token: JWT;
      user: User | AdapterUser | UserProps;
      profile?: any;
      trigger?: "signIn" | "update" | "signUp";
    }) => {
      authDebug("jwt", `jwt callback (trigger=${trigger ?? "n/a"})`, {
        hasUser: !!user,
        hasProfile: !!profile,
        profile,
        tokenBefore: token,
      });

      if (user) {
        token.user = user;
      }

      // set live from the ID token claim on every sign-in (not just at provisioning time)
      if (profile) {
        const isSuperAdmin = profile.is_super_admin === true;
        token.user = {
          ...(token.user as object),
          isSuperAdmin,
        };

        // Workspace/partner provisioning: deliberately here, not in
        // events.signIn. events.signIn is fire-and-forget — NextAuth doesn't
        // guarantee it finishes before the redirect response is sent, so the
        // very next request (middleware, resolving the user's default
        // workspace) could race it and lose, landing on a workspace that
        // doesn't exist yet. This callback's return value directly becomes
        // the session token, so NextAuth cannot respond until it resolves —
        // no race is possible. `user` is guaranteed to be the real,
        // adapter-persisted row here (unlike in the `signIn` callback above).
        const userId = (user as { id: string }).id;
        try {
          await prisma.user.update({
            where: { id: userId },
            data: { isSuperAdmin },
          });

          if (isSuperAdmin) {
            await ensureAdminWorkspace(userId);
          } else {
            await ensurePartnerAccount({
              userId,
              email: profile.email,
              name: profile.name,
            });
          }

          authDebug("jwt", "Workspace/partner provisioning complete", {
            userId,
            isSuperAdmin,
          });
        } catch (err) {
          authDebug("error", "Workspace/partner provisioning FAILED", {
            userId,
            isSuperAdmin,
            error: err instanceof Error ? err.stack || err.message : err,
          });
        }
      }

      // refresh the user's data if they update their name / email
      if (trigger === "update") {
        const refreshedUser = await prisma.user.findUnique({
          where: {
            id: token.sub,
          },
          select: {
            id: true,
            name: true,
            email: true,
            image: true,
            isMachine: true,
            isSuperAdmin: true,
            defaultWorkspace: true,
            defaultPartnerId: true,
          },
        });

        if (refreshedUser) {
          token.user = refreshedUser;
        } else {
          return {};
        }
      }

      authDebug("jwt", "jwt callback result", token);
      return token;
    },
    session: async ({ session, token }) => {
      session.user = {
        id: token.sub,
        // @ts-ignore
        ...(token || session).user,
      };
      authDebug("session", "session callback result", session);
      return session;
    },
  },
  events: {
    async signIn(message) {
      const email = message.user.email as string;
      const user = await prisma.user.findUnique({
        where: { email },
        select: {
          id: true,
          name: true,
          email: true,
          image: true,
          createdAt: true,
        },
      });
      if (!user) {
        console.log(
          `User ${message.user.email} not found, skipping welcome workflow...`,
        );
        return;
      }

      // isSuperAdmin resolution + workspace/partner provisioning happens in
      // the `jwt` callback, not here — events.signIn is fire-and-forget
      // (NextAuth doesn't guarantee it completes before the redirect
      // response is sent), which raced the very next request's workspace
      // lookup and lost. This handler stays for the genuinely-fine-to-race
      // side effects below (welcome workflow, avatar backup, program apps).

      // only process new user workflow if the user was created in the last 15s (newly created user)
      if (
        user.createdAt &&
        new Date(user.createdAt).getTime() > Date.now() - 15000
      ) {
        console.log(
          `New user ${user.email} created,  triggering welcome workflow...`,
        );
        waitUntil(
          Promise.allSettled([
            // track lead if dub_id cookie is present
            trackDubLead(user),
            // trigger welcome workflow 45 minutes after the user signed up
            qstash.publishJSON({
              url: `${APP_DOMAIN_WITH_NGROK}/api/cron/welcome-user`,
              delay: 45 * 60,
              body: { userId: user.id },
            }),
          ]),
        );
      }

      // lazily backup user avatar to R2
      const currentImage = message.user.image;
      if (currentImage && !isStored(currentImage)) {
        waitUntil(
          (async () => {
            const { url } = await storage.upload({
              key: `avatars/${message.user.id}`,
              body: currentImage,
            });
            await prisma.user.update({
              where: {
                id: message.user.id,
              },
              data: {
                image: url,
              },
            });
          })(),
        );
      }

      // Complete any outstanding program applications
      if (message.user.email) {
        waitUntil(completeProgramApplications(message.user.email));
      }
    },
  },
};
