#!/usr/bin/env bash
set -euo pipefail

# Gated deploy: type-check -> dependency audit -> secret/file sanity check
# -> tests -> build (via AWS CodeBuild — this monorepo's production build
# reliably OOMs on a typical 8GB dev machine, even with parallelism capped)
# -> roll out to the EC2 instance behind the ALB via SSH (NOT SSM — this
# AMI has no amazon-ssm-agent installed at all, confirmed the hard way)
# -> confirm it's actually healthy before declaring success. Any failed
# check stops the deploy — nothing gets built or pushed until everything
# above it is green.
#
# Usage: ./deploy.sh

AWS_REGION="ap-south-1"
AWS_ACCOUNT_ID="348881530370"
ECR_REPO="affiliate"
CODEBUILD_PROJECT="affiliate-build"
CODEBUILD_BUCKET="affiliate-codebuild-source-348881530370"
EC2_INSTANCE_ID="i-0058e95a8aa6dd93d"
SSH_KEY="$HOME/.ssh/affiliate-ec2-key.pem"
TARGET_GROUP_ARN="arn:aws:elasticloadbalancing:ap-south-1:348881530370:targetgroup/affiliate-tg/11898eaf74106b06"
ECR_URI="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${ECR_REPO}"
LIVE_URL="https://affiliate.spacemarvel.com"
ENV_FILE="apps/web/.env.production"

cd "$(dirname "$0")"

step() { echo; echo "==> $1"; }
ok()   { echo "    ✓ $1"; }

# ---- 1. Type check ---------------------------------------------------
step "Type-checking apps/web"
( cd apps/web && NODE_OPTIONS="--max-old-space-size=6144" npx tsc --noEmit )
ok "no type errors"

# ---- 2. Dependency security audit -------------------------------------
# --prod: pnpm audit has no true per-package scoping (it always audits the
# whole workspace lockfile), so --prod at least excludes devDependency-only
# noise (test tooling, the hubspot-app dev CLI, etc.) that's never built into
# this container. --audit-level=critical (not high): as of the last full
# triage, criticals were fixed down to one confirmed non-applicable finding
# entirely inside packages/hubspot-app (a private, non-deployed dev tool);
# the remaining ~136 highs are overwhelmingly the same non-deployed noise
# plus a few real ones needing risky major version bumps (nodemailer,
# @tiptap/core) not yet done. Re-tighten to --audit-level=high once those
# are addressed.
step "Auditing dependencies for known vulnerabilities"
AUDIT_OUTPUT="$(NODE_OPTIONS="--max-old-space-size=6144" pnpm audit --prod --audit-level=critical 2>&1)"
AUDIT_EXIT=$?
if [ $AUDIT_EXIT -ne 0 ]; then
  echo "$AUDIT_OUTPUT"
  if echo "$AUDIT_OUTPUT" | grep -qi "out of memory\|Abort trap\|FATAL ERROR"; then
    echo "    ✗ pnpm audit crashed (out of memory) — not an actual vulnerability finding. Re-run with more RAM available, or skip this check manually if urgent."
  else
    echo "    ✗ pnpm audit found critical vulnerabilities in production dependencies — fix before deploying."
  fi
  exit 1
fi
ok "no critical vulnerabilities in production dependencies (gate: --audit-level=critical, --prod — see note below)"

# ---- 3. Secret / file sanity check -------------------------------------
step "Scanning for accidentally committed secrets"
TRACKED_ENVS="$(git ls-files | grep -E '(^|/)\.env($|\.[^.]*$)' | grep -v '\.env\.example$' || true)"
if [ -n "$TRACKED_ENVS" ]; then
  echo "    ✗ .env file(s) tracked in git — remove them before deploying:"
  echo "$TRACKED_ENVS"
  exit 1
fi
if git grep -InE "AKIA[0-9A-Z]{16}|-----BEGIN (RSA |EC )?PRIVATE KEY-----" -- . ':!*.md' ':!deploy.sh' 2>/dev/null; then
  echo "    ✗ something that looks like a live AWS key or private key is committed — stop and check the lines above."
  exit 1
fi
ok "no tracked .env files, no obvious committed keys"

# ---- 4. Tests -----------------------------------------------------------
step "Running test suite"
# Two categories of tests need live infrastructure this deploy script can't
# provide, so they're excluded here only (both still run normally via plain
# `pnpm test` if you have that infrastructure up):
#   - tests/webhooks/index.test.ts needs a live ngrok tunnel (Upstash QStash
#     rejects a localhost callback URL outright).
#   - every test importing tests/utils/env.ts (the E2E_BASE_URL/E2E_TOKEN
#     integration suite) needs a live deployed target + real API tokens.
# The E2E list is found fresh each run (by what it imports, not a hardcoded
# path list) so a newly added E2E test is picked up automatically.
# vitest's --exclude glob is matched relative to the `test.dir` config
# ("./tests"), not the repo path grep prints — so the leading "tests/" has
# to be stripped and replaced with "**/" or these silently fail to match.
TEST_EXCLUDES=(--exclude "**/webhooks/index.test.ts")
while IFS= read -r f; do
  TEST_EXCLUDES+=(--exclude "**/${f#tests/}")
done < <(cd apps/web && grep -rl "from.*utils/integration\|from.*utils/env" tests --include="*.test.ts")
( cd apps/web && CI=1 pnpm test -- "${TEST_EXCLUDES[@]}" )
ok "tests passed"

# ---- 5. Production env file must exist locally (never committed — see .gitignore) --
if [ ! -f "$ENV_FILE" ]; then
  echo "    ✗ $ENV_FILE not found — this holds the real runtime secrets (DATABASE_URL, etc.) and is gitignored on purpose. Create it before deploying."
  exit 1
fi
ok "$ENV_FILE present"

# ---- 6. Package + upload source, build via CodeBuild ------------------------
step "Packaging source and uploading to S3"
TMP_ZIP="$(mktemp -t affiliate-source-XXXX).zip"
git archive --format=zip -o "$TMP_ZIP" HEAD
aws s3 cp "$TMP_ZIP" "s3://${CODEBUILD_BUCKET}/source.zip" --region "$AWS_REGION" >/dev/null
rm -f "$TMP_ZIP"
ok "source uploaded"

step "Building image via CodeBuild (this takes a few minutes)"
BUILD_ID="$(aws codebuild start-build --project-name "$CODEBUILD_PROJECT" --region "$AWS_REGION" --query "build.id" --output text)"
echo "    build: $BUILD_ID"
while true; do
  read -r BUILD_STATUS PHASE <<< "$(aws codebuild batch-get-builds --ids "$BUILD_ID" --region "$AWS_REGION" --query "builds[0].[buildStatus,currentPhase]" --output text)"
  case "$BUILD_STATUS" in
    SUCCEEDED) ok "build succeeded"; break ;;
    FAILED|FAULT|STOPPED|TIMED_OUT)
      echo "    ✗ CodeBuild failed ($BUILD_STATUS, phase $PHASE)."
      echo "      Logs: /aws/codebuild/${CODEBUILD_PROJECT}, stream ${BUILD_ID##*:}"
      exit 1 ;;
  esac
  sleep 15
done

# ---- 7. Roll out to the EC2 instance via SSH ---------------------------------
step "Deploying to EC2 instance ($EC2_INSTANCE_ID) via SSH"
if [ ! -f "$SSH_KEY" ]; then
  echo "    ✗ SSH key not found at $SSH_KEY"
  exit 1
fi

EC2_IP="$(aws ec2 describe-instances --instance-ids "$EC2_INSTANCE_ID" --region "$AWS_REGION" \
  --query "Reservations[0].Instances[0].PublicIpAddress" --output text)"
if [ -z "$EC2_IP" ] || [ "$EC2_IP" = "None" ]; then
  echo "    ✗ Could not resolve a public IP for $EC2_INSTANCE_ID — is it running?"
  exit 1
fi
echo "    instance IP: $EC2_IP"

SSH_OPTS=(-o StrictHostKeyChecking=no -i "$SSH_KEY")
scp "${SSH_OPTS[@]}" "$ENV_FILE" ec2-user@"$EC2_IP":/tmp/affiliate.env

ssh "${SSH_OPTS[@]}" ec2-user@"$EC2_IP" "
  sudo mv /tmp/affiliate.env /etc/affiliate.env &&
  sudo chmod 600 /etc/affiliate.env &&
  aws ecr get-login-password --region $AWS_REGION | sudo docker login --username AWS --password-stdin ${ECR_URI%/*} &&
  sudo docker pull ${ECR_URI}:latest &&
  sudo docker image prune -af &&
  (sudo docker rm -f affiliate-app || true) &&
  sudo docker run -d --name affiliate-app --restart unless-stopped --env-file /etc/affiliate.env -p 3000:3000 ${ECR_URI}:latest &&
  sleep 8 &&
  curl -sf http://localhost:3000/api/health
"
ok "container running"

# ---- 8. Confirm it's actually healthy behind the ALB, don't just assume ------
step "Waiting for the target to go healthy behind the load balancer"
HEALTH="initial"
for i in $(seq 1 30); do
  HEALTH="$(aws elbv2 describe-target-health --target-group-arn "$TARGET_GROUP_ARN" --region "$AWS_REGION" --query "TargetHealthDescriptions[0].TargetHealth.State" --output text 2>/dev/null || echo initial)"
  if [ "$HEALTH" = "healthy" ]; then
    echo
    echo "✅ Deployment successful — live at ${LIVE_URL}"
    exit 0
  fi
  sleep 5
done

echo
echo "❌ Target did not become healthy in time (last state: $HEALTH)."
echo "   Check: aws elbv2 describe-target-health --target-group-arn $TARGET_GROUP_ARN --region $AWS_REGION"
exit 1
