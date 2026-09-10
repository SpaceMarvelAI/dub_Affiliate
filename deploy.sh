#!/usr/bin/env bash
set -euo pipefail

# Gated deploy: type-check -> dependency audit -> secret/file sanity check
# -> tests -> build (via AWS CodeBuild — this monorepo's production build
# reliably OOMs on a typical 8GB dev machine, even with parallelism capped)
# -> roll out to the EC2 instance behind the ALB via SSM (no SSH/key-pair
# needed) -> confirm it's actually healthy before declaring success. Any
# failed check stops the deploy — nothing gets built or pushed until
# everything above it is green.
#
# Usage: ./deploy.sh

AWS_REGION="ap-south-1"
AWS_ACCOUNT_ID="348881530370"
ECR_REPO="affiliate"
CODEBUILD_PROJECT="affiliate-build"
CODEBUILD_BUCKET="affiliate-codebuild-source-348881530370"
EC2_INSTANCE_ID="i-0c10c25d6b8aa896a"
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
step "Auditing dependencies for known vulnerabilities"
if ! pnpm audit --audit-level=high; then
  echo "    ✗ pnpm audit found high/critical vulnerabilities — fix or explicitly override before deploying."
  exit 1
fi
ok "no high/critical vulnerabilities"

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
( cd apps/web && pnpm test )
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

# ---- 7. Roll out to the EC2 instance via SSM (no SSH/key-pair) ---------------
step "Deploying to EC2 instance ($EC2_INSTANCE_ID) via SSM"
ENV_B64="$(base64 < "$ENV_FILE" | tr -d '\n')"
COMMAND_ID="$(aws ssm send-command \
  --instance-ids "$EC2_INSTANCE_ID" \
  --document-name "AWS-RunShellScript" \
  --parameters "commands=[
    \"aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin ${ECR_URI%/*}\",
    \"docker pull ${ECR_URI}:latest\",
    \"echo $ENV_B64 | base64 -d > /etc/affiliate.env\",
    \"docker rm -f affiliate-app 2>/dev/null || true\",
    \"docker run -d --name affiliate-app --restart unless-stopped --env-file /etc/affiliate.env -p 3000:3000 ${ECR_URI}:latest\"
  ]" \
  --region "$AWS_REGION" --query "Command.CommandId" --output text)"
echo "    ssm command: $COMMAND_ID"

while true; do
  STATUS="$(aws ssm get-command-invocation --command-id "$COMMAND_ID" --instance-id "$EC2_INSTANCE_ID" --region "$AWS_REGION" --query "Status" --output text 2>/dev/null || echo Pending)"
  case "$STATUS" in
    Success) ok "container running"; break ;;
    Failed|Cancelled|TimedOut)
      echo "    ✗ SSM deploy command failed ($STATUS)."
      aws ssm get-command-invocation --command-id "$COMMAND_ID" --instance-id "$EC2_INSTANCE_ID" --region "$AWS_REGION" --query "StandardErrorContent" --output text
      exit 1 ;;
  esac
  sleep 5
done

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
