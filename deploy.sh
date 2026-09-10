#!/usr/bin/env bash
set -euo pipefail

# Gated deploy: type-check -> dependency audit -> secret/file sanity check
# -> tests -> build -> push -> roll out to ECS -> confirm it's actually
# healthy before declaring success. Any failed check stops the deploy —
# nothing gets built or pushed until everything above it is green.
#
# Usage: ./deploy.sh

AWS_REGION="ap-south-1"
AWS_ACCOUNT_ID="348881530370"
ECR_REPO="affiliate"
ECS_CLUSTER="affiliate-cluster"
ECS_SERVICE="affiliate-service"
ECR_URI="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${ECR_REPO}"
LIVE_URL="https://affiliate.spacemarvel.com"

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

# ---- 5. Build the image --------------------------------------------------
IMAGE_TAG="$(git rev-parse --short HEAD 2>/dev/null || date +%s)"
step "Building image (tag: ${IMAGE_TAG})"
aws ecr get-login-password --region "$AWS_REGION" \
  | docker login --username AWS --password-stdin "${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
docker build --platform linux/amd64 \
  -t "${ECR_URI}:${IMAGE_TAG}" \
  -t "${ECR_URI}:latest" \
  -f Dockerfile .
ok "image built"

# ---- 6. Push --------------------------------------------------------------
step "Pushing image to ECR"
docker push "${ECR_URI}:${IMAGE_TAG}"
docker push "${ECR_URI}:latest"
ok "pushed ${ECR_URI}:${IMAGE_TAG} and :latest"

# ---- 7. Roll out to ECS ----------------------------------------------------
step "Rolling out to ECS"
aws ecs update-service \
  --cluster "$ECS_CLUSTER" \
  --service "$ECS_SERVICE" \
  --force-new-deployment \
  --region "$AWS_REGION" >/dev/null
ok "new deployment triggered"

# ---- 8. Wait for it to actually go healthy, don't just assume ------------
step "Waiting for the service to reach steady state (this can take a few minutes)"
if aws ecs wait services-stable \
    --cluster "$ECS_CLUSTER" \
    --services "$ECS_SERVICE" \
    --region "$AWS_REGION"; then
  echo
  echo "✅ Deployment successful — live at ${LIVE_URL}"
else
  echo
  echo "❌ Deployment did NOT reach a stable healthy state in time."
  echo "   Check: aws ecs describe-services --cluster $ECS_CLUSTER --services $ECS_SERVICE --region $AWS_REGION --query 'services[0].events[:10]'"
  exit 1
fi
