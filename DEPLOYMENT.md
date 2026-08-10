# Space Marvel — Deployment Handoff (AWS)

This document is for the deploy/infra team. It covers: (1) what was changed in the rebrand from "Dub" to "Space Marvel", (2) the application architecture, (3) the database (MySQL) structure, (4) required third-party services and environment variables, (5) a Docker image spec, and (6) an AWS deployment plan including cron job replacement.

**Read the "Known Vercel-specific couplings" section before starting** — this codebase was originally built for Vercel hosting + PlanetScale, and a few things need a decision before they'll work correctly on plain AWS infrastructure.

---

## 1. What changed (rebrand summary)

The app was originally "Dub" (an open-source link-attribution/affiliate platform, dub.co). It has been rebranded to **Space Marvel** at the UI/text level only. What that means concretely:

- **Logo/wordmark**: `packages/ui/src/logo.tsx` and `packages/ui/src/wordmark.tsx` now render an actual logo image (`apps/web/public/space-marvel-logo.png`) instead of Dub's SVG mark. A CSS `invert dark:invert-0` trick is applied because the source PNG is white line-art on transparent background (correct for dark mode, inverted to black for light mode).
- **Favicon / PWA icons**: `apps/web/app/icon.png`, `apps/web/app/apple-icon.png`, and `apps/web/public/space-marvel-icon-maskable.png` are the Space Marvel mark composited onto a solid dark background (needed because static favicons can't use the CSS invert trick).
- **Page titles & meta**: `packages/utils/src/functions/construct-metadata.ts` and `apps/web/app/manifest.ts` — default title/description/PWA name now say "Space Marvel".
- **~170 lines across ~115 files**: email subject lines, in-app error/toast messages, nav labels, onboarding copy — literal "Dub" text replaced with "Space Marvel". Playwright tests that asserted on the old text were updated to match.
- **Removed a personal signature**: the subscription-cancellation email was signed "Steven Tey, Founder, Dub.co" (a real person, the actual founder of Dub Inc.) — replaced with a generic "The Space Marvel Team" sign-off.

**Deliberately NOT changed** (flag these to whoever owns the account/domain decisions):
- `dub.co` / `dub.sh` / `dubcdn.com` / `partners.dub.co` / `app.dub.co` / `admin.dub.co` hostnames — thousands of references, and they drive actual hostname-based routing logic (which portal renders depends on the subdomain). Changing these is a real migration, not a text edit — see §7.
- The `@dub/*` internal npm package scope (workspace package names like `@dub/ui`, `@dub/utils`) — cosmetic/internal only, doesn't affect users, left as-is to minimize diff size.
- SCIM/SAML `product: "Dub"` identifiers and the `Dub-Signature` webhook header name — these are functional integration contracts (WorkOS SCIM directory matching, outgoing webhook signature header that customers' systems verify against). Renaming breaks those integrations.
- The `DUB_WORDMARK` image asset referenced in ~90 transactional email templates (`packages/email/src/templates/*.tsx`) still shows Dub's actual logo image — only the `alt` text was left alone to match. **Needs a decision**: either host a Space Marvel version of that image and swap the constant, or leave it (these are internal transactional emails: welcome, password reset, payout notifications, etc.)
- One-off historical marketing "broadcast" emails (`packages/email/src/templates/broadcasts/*`) — dead campaign content (launch weeks, wrapped-style recaps), not touched.
- The email `from`/`replyTo` addresses (`steven@dub.co`, `steven.tey@dub.co`) in the cancellation-feedback email — still point at a real Dub Inc. mailbox. The display name was removed, but the actual address wasn't changed since it depends on what mail domain/mailbox you'll actually use (see §5, `RESEND_API_KEY` / SMTP config).

---

## 2. Architecture overview

Monorepo (pnpm workspaces + Turborepo):

```
apps/
  web/            ← the actual product: Next.js 15 (App Router), single deployable app
packages/
  ui/             ← shared React components (workspace package @dub/ui)
  utils/          ← shared utils (@dub/utils) — includes constructMetadata, constants
  email/          ← React Email templates, sent via Resend/SMTP
  tinybird/       ← analytics datasource/pipe definitions (deployed separately to Tinybird)
  cli/, embeds/, hubspot-app/, stripe-app/, tailwind-config/, tsconfig/
```

`apps/web` is a single Next.js app that serves **four different products off different hostnames** via `apps/web/middleware.ts`:
- Main app dashboard (`app.dub.co` in the original — whatever your app subdomain is)
- Partner portal (`partners.dub.co` equivalent)
- Admin panel (`admin.dub.co` equivalent)
- Public link redirects + marketing pages (the bare/default domain, plus any custom short-link domains customers add)

This hostname-based routing is why the `dub.co`/`dub.sh` domain references are load-bearing, not cosmetic — see §7.

**Stack**: Next.js 15 / React, TypeScript, Prisma ORM, MySQL, Tailwind. Background jobs via Upstash QStash (HTTP-based queue). Click/conversion analytics via Tinybird (ClickHouse-based SaaS, not self-hosted). Caching/rate-limiting via Redis (Upstash REST API in prod).

---

## 3. Database — MySQL

- **Engine**: MySQL 8.0 (Prisma datasource provider is `mysql`, confirmed in `apps/web/prisma/schema/schema.prisma`). Any MySQL-8-compatible service works (AWS RDS for MySQL 8.0, or Aurora MySQL 8.0-compatible).
- **Schema size**: 83 Prisma models across 37 schema files (multi-file schema under `apps/web/prisma/schema/`). Covers users/auth, workspaces (`Project`), links, domains, partners/programs/commissions/payouts, fraud rules, webhooks, OAuth apps, and more.
- **Important**: `relationMode = "prisma"` is set in the datasource block. This means **no real foreign-key constraints in the database** — Prisma enforces relations at the application level instead. This was inherited from PlanetScale (which historically didn't support FKs), but it applies regardless of which MySQL you use now. Don't be surprised by the lack of FK constraints when inspecting the schema directly in MySQL — that's expected, not a migration bug.
- **Migrations**: this repo does not use `prisma migrate` — it uses `prisma db push` (see `apps/web/package.json` script `prisma:push`). That means there's no migration history table; schema changes are applied by diffing the current DB against `schema.prisma` and pushing the difference. For a first deploy: run `pnpm prisma:push` (or `npx prisma db push --schema=./prisma/schema`) against the target database once it's reachable, before starting the app.
- **Generate the Prisma client** as part of every build: `pnpm prisma:generate` (already wired into `apps/web`'s `build` script).

### Recommended AWS setup
- **Amazon RDS for MySQL 8.0** (or Aurora MySQL 8.0-compatible for better scaling), sized to at least handle moderate connection counts — this app is a serverless/edge-friendly Next.js app that can open many concurrent short-lived connections. Consider **RDS Proxy** in front of it to avoid exhausting max_connections when running multiple app instances/containers.
- Put the DB in a private subnet; only the app's ECS/EKS security group should reach it on 3306.

---

## 4. Required third-party services & environment variables

Full reference: `apps/web/.env.example` (192 lines, required vars clearly marked at the top). Summary of what's **required for the app to boot and function**:

| Variable(s) | Purpose | Notes for AWS deploy |
|---|---|---|
| `DATABASE_URL` | MySQL connection string | Point at the RDS/Aurora endpoint: `mysql://user:pass@host:3306/dbname` |
| `NEXTAUTH_SECRET`, `NEXTAUTH_URL` | Auth session encryption / callback base URL | Generate secret with `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |
| `CRON_SECRET` | Authenticates cron-triggered API calls | You'll pass this as a header when calling cron endpoints yourself (see §6) |
| `ENCRYPTION_KEY` | AES-256-GCM key for encrypting sensitive DB fields | Same generation method as above |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Redis caching, via HTTP (not raw Redis protocol) | Either use real Upstash Redis (works from anywhere, no VPC needed), or self-host Redis + the `serverless-redis-http` shim (see docker-compose, described below) pointed at an ElastiCache Redis instance |
| `QSTASH_URL`, `QSTASH_TOKEN`, `QSTASH_CURRENT_SIGNING_KEY`, `QSTASH_NEXT_SIGNING_KEY` | Background job queue (Upstash QStash) | This is a managed SaaS queue — no AWS equivalent needed, just an Upstash account |
| `TINYBIRD_API_KEY`, `TINYBIRD_API_URL` | Click/conversion analytics ingestion & queries | External SaaS (ClickHouse-based). The datasource/pipe definitions live in `packages/tinybird/` and must be deployed to a Tinybird workspace separately using the Tinybird CLI — this is not part of the AWS deploy |
| `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET` (or `SMTP_*`) | Transactional email sending | Use Resend, or configure SMTP vars to point at your own mail provider |
| `TEAM_ID_VERCEL`, `VERCEL_API_KEY` | **Vercel Domains API** — used for provisioning custom domains customers add | **This is Vercel-specific and will not work off Vercel.** See §7 — you need a decision here before self-hosting is fully functional |

**Optional but likely wanted**: `STRIPE_*` (billing), `GOOGLE_CLIENT_ID/SECRET` + `GITHUB_CLIENT_ID/SECRET` (social login), `STORAGE_*` (S3-compatible object storage for uploaded images/logos — **use an actual S3 bucket + IAM credentials here**, this is the natural AWS-native piece), `ANTHROPIC_API_KEY` (AI support features).

There's also a large "DUB.CO INTERNAL USE ONLY" section at the bottom of `.env.example` (Slack app, Dynadot domain registration, Twitter/TikTok/YouTube verification, PayPal, Tremendous, Hubspot/Intercom integrations, etc.) — these are optional integrations tied to Dub's own accounts with those providers. Leave unset unless you're setting up your own accounts for those integrations.

Get every secret into **AWS Secrets Manager** (or SSM Parameter Store) — do not bake them into the Docker image or commit `.env` files.

---

## 5. Docker image

No Dockerfile exists in the repo yet — here's one to add at the repo root (`Dockerfile`), written for this pnpm+Turborepo monorepo, multi-stage to keep the final image small:

```dockerfile
# syntax=docker/dockerfile:1

FROM node:20-slim AS base
RUN corepack enable
WORKDIR /app

# ---- deps: install once, cached across builds ----
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/ui/package.json packages/ui/package.json
COPY packages/utils/package.json packages/utils/package.json
COPY packages/email/package.json packages/email/package.json
COPY packages/tinybird/package.json packages/tinybird/package.json
COPY packages/tailwind-config/package.json packages/tailwind-config/package.json
COPY packages/tsconfig/package.json packages/tsconfig/package.json
RUN pnpm install --frozen-lockfile

# ---- build ----
FROM deps AS build
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# Prisma client generation + Next build (build-time env vars, e.g. NEXT_PUBLIC_*,
# must be passed via --build-arg / buildkit secrets as needed)
RUN pnpm --filter web prisma:generate
RUN pnpm --filter web build

# ---- runtime ----
FROM node:20-slim AS runner
RUN corepack enable
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# If next.config is updated to `output: "standalone"` (recommended, see note below),
# replace this block with copying only .next/standalone + .next/static + public.
COPY --from=build /app /app
WORKDIR /app/apps/web

EXPOSE 3000
CMD ["pnpm", "start"]
```

**Recommended change before building**: add `output: "standalone"` to `apps/web/next.config.ts`. Right now the image above copies the *entire* built monorepo (all `node_modules`) into the final stage, which works but produces a large image. With `output: "standalone"`, Next.js traces exactly which files are needed and writes a minimal self-contained server to `.next/standalone` — the runtime stage then only needs to copy that folder + `.next/static` + `public/`, cutting image size significantly. This is a one-line config change; ask the app team before flipping it in case something depends on the non-standalone output.

**Build-time vs runtime env vars**: any `NEXT_PUBLIC_*` variable (e.g. `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`) gets baked into the client JS bundle at **build** time, not read at runtime. Pass those as Docker build args / buildkit secrets during CI, not just as container runtime env vars, or they'll be missing from the compiled output.

**Local dev services reference** (`apps/web/docker-compose.yml`) — for context on what a full local stack needs (not what you deploy to AWS, but shows the service shape):
```yaml
services:
  ps-mysql:        # MySQL 8.0 — stand-in for prod MySQL/RDS
  planetscale-proxy:  # HTTP-to-MySQL shim, only needed for local dev / PlanetScale-style edge access — see §7
  mailhog:         # local SMTP catcher — swap for Resend/real SMTP in prod
  redis:           # real Redis — swap for Upstash Redis (HTTP) in prod, or...
  redis-http:      # ...HTTP-to-Redis shim (serverless-redis-http), if you want to keep using Redis over HTTP against a self-hosted Redis instead of Upstash
```

---

## 6. AWS deployment plan

**Recommended shape**: ECS Fargate (simplest, no cluster management) running the Docker image above, behind an Application Load Balancer, with RDS MySQL and Secrets Manager. EKS is also fine if you already run Kubernetes elsewhere — nothing here is Fargate-specific.

1. **RDS MySQL 8.0** in a private subnet. Run `pnpm prisma:push` once (from a one-off task/bastion, or as a CI migration step) against it before first deploy.
2. **ECR repo** for the built image; CI builds & pushes on merge to main.
3. **ECS Fargate service** running the image, task role with permission to read the Secrets Manager secrets it needs. Put all env vars from §4 into the task definition (as `secrets`, pulling from Secrets Manager, not plaintext `environment`).
4. **ALB** in front, HTTPS via ACM cert. `NEXTAUTH_URL` must match whatever hostname the ALB/CloudFront serves.
5. **S3 bucket** for the `STORAGE_*` vars (uploaded logos/images) — use an IAM role on the task, not static keys, if possible.
6. **Redis**: either point `UPSTASH_REDIS_REST_URL`/`TOKEN` at a real Upstash Redis instance (simplest — no VPC networking needed, works over HTTPS from anywhere), or run ElastiCache Redis + the `serverless-redis-http` shim container (from the docker-compose reference) as a small sidecar/service in front of it if you specifically want Redis inside your VPC instead of an external SaaS.
7. **Cron jobs — replace Vercel Cron.** The app defines 22 cron jobs in `apps/web/vercel.json`, several running every minute. Vercel's own cron scheduler won't exist once you're off Vercel — replicate these with **Amazon EventBridge Scheduler** rules, each one making an authenticated HTTP call to the corresponding endpoint (e.g. `POST https://<your-host>/api/cron/streams/update-click-stats` with an `Authorization: Bearer $CRON_SECRET` header, matching however the route checks `CRON_SECRET` — check the route handler for the exact expected header/param name). Full list to replicate:

   | Schedule | Endpoint |
   |---|---|
   | `0 * * * *` | `/api/cron/domains/verify` |
   | `0 * * * *` | `/api/cron/email-domains/verify` |
   | `0 8 * * *` | `/api/cron/domains/renewal-reminders` |
   | `0 8 * * *` | `/api/cron/domains/renewal-payments` |
   | `* * * * *` | `/api/cron/streams/send-link-clicked-webhooks` |
   | `* * * * *` | `/api/cron/streams/update-click-stats` |
   | `* * * * *` | `/api/cron/streams/update-workspace-links-usage` |
   | `*/2 * * * *` | `/api/cron/streams/update-partner-stats` |
   | `* * * * *` | `/api/cron/partner-platforms/website` |
   | `0 13 1 * *` | `/api/cron/partner-program-summary` |
   | `0 9 * * *` | `/api/cron/pending-applications-summary` |
   | `0 * * * *` | `/api/cron/trial-emails` |
   | `0 * * * *` | `/api/cron/payouts/aggregate-due-commissions` |
   | `0 1,13 * * *` | `/api/cron/trigger-withdrawal` |
   | `40 0,8,12,20 * * *` | `/api/cron/trigger-backup` |
   | `0 12 * * *` | `/api/cron/payouts/force-withdrawals` |
   | `0 14 * * *` | `/api/cron/payouts/reminders/partners` |
   | `0 13 25-31,1-5 * *` | `/api/cron/payouts/reminders/program-owners` |
   | `0 * * * *` | `/api/cron/bounties/queue-sync-social-metrics` |
   | `0 2 * * *` | `/api/cron/sitemaps/queue` |
   | `*/5 * * * *` | `/api/cron/webhooks/sync-click-workspaces` |
   | `* * * * *` | `/api/cron/queue/retry` |

   Note `trigger-backup` — check what it actually backs up before assuming it's a no-op once off PlanetScale (PlanetScale had built-in backups; on RDS you already get automated snapshots, so this endpoint's logic may need review, not just rescheduling).

8. **Health checks**: point the ALB target group health check at a lightweight route (check if one exists, e.g. `/api/health`; if not, ask the app team — don't health-check a page that hits the DB/Tinybird on every check).

---

## 7. Known Vercel/PlanetScale-specific couplings — decide these before go-live

These are things that will silently misbehave rather than loudly crash, so flag them explicitly:

1. **Vercel Domains API (`TEAM_ID_VERCEL`, `VERCEL_API_KEY`)**: used to provision SSL/DNS for custom domains customers add to their links (e.g. a customer's `go.acme.com`). This is a Vercel-only API. Off Vercel, there is no drop-in replacement — you'd need to build an equivalent using ACM + Route53/CloudFront (or Cloudflare for SaaS, or a similar provider), which is real engineering work, not a config change. Until that's built, custom-domain provisioning for end customers will not work. Confirm with the app team whether custom domains are actually needed at launch.

2. **Edge runtime + PlanetScale's HTTP-based DB driver**: `apps/web/lib/prisma/edge.ts` uses `@prisma/adapter-planetscale`, which talks to the database over HTTP (PlanetScale's protocol) instead of a normal MySQL TCP connection — because Next.js "Edge runtime" routes/middleware can't open raw TCP sockets. About 10 routes (`app/api/route.ts`, `app/api/og/*`, `app/[domain]/[key]/inspect/page.tsx`, a few more — search `runtime = "edge"` in `apps/web/app`) plus several middleware helpers (`lib/middleware/admin.ts`, `workspaces.ts`, etc.) depend on this. **A standard RDS MySQL instance does not speak PlanetScale's HTTP protocol**, so these specific code paths will break if you just swap `DATABASE_URL` to point at RDS and leave everything else as-is. Two options:
   - **(a)** Run the same `ps-http-sim` proxy container used in local dev (`ghcr.io/mattrobenolt/ps-http-sim`) in front of your RDS instance in production too, and set `PLANETSCALE_DATABASE_URL` accordingly. This is the lowest-effort fix — no code changes, just one more small container.
   - **(b)** Change the affected routes/middleware to Node.js runtime and use the standard Prisma client (`lib/prisma/index.ts`) instead of the edge one — more correct long-term, but requires the app team's involvement (Edge runtime was presumably chosen for a reason — likely middleware performance — so check before removing it).

   Recommend **(a)** as a stopgap for launch, **(b)** as a follow-up if it turns out edge runtime isn't actually needed off Vercel.

3. **Vercel Cron** — already covered in §6, replaced with EventBridge Scheduler.

4. **`dub.co`/`dub.sh` hostname-based routing** — not urgent to fix for an internal/first deploy (the app will run fine on whatever hostname you point it at for the main dashboard), but if you want the marketing/redirect/partner-portal split to work under your own domains, `apps/web/middleware.ts` and `apps/web/lib/utils` constants (`APP_HOSTNAMES`, `PARTNERS_HOSTNAMES`, `ADMIN_HOSTNAMES`, etc.) need to be updated to match your real subdomains. This is a separate, larger piece of work from what's in this document — flag it back to the app team if/when you're ready to tackle it.

---

## 8. Quick pre-launch checklist

- [ ] RDS MySQL 8.0 provisioned, reachable from the ECS task's subnet
- [ ] `pnpm prisma:push` run against it successfully
- [ ] All required env vars (§4) in Secrets Manager, wired into the task definition
- [ ] Decision made on Vercel Domains API (§7.1) — even if the answer is "not needed yet"
- [ ] Decision made on edge-runtime PlanetScale driver (§7.2) — recommend the `ps-http-sim` stopgap
- [ ] 22 cron jobs replicated in EventBridge Scheduler (§6.7), pointed at the deployed app with the correct `CRON_SECRET` auth
- [ ] Tinybird workspace set up separately, datasources/pipes from `packages/tinybird/` deployed via the Tinybird CLI, `TINYBIRD_API_KEY`/`TINYBIRD_API_URL` set
- [ ] S3 bucket + IAM role for `STORAGE_*`
- [ ] Resend account (or SMTP) configured for outbound email
- [ ] Decision on the `DUB_WORDMARK` email logo image (§1) — still shows Dub's logo in transactional emails until replaced
