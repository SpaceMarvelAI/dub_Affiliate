#!/usr/bin/env bash
# Runs backend + frontend dev servers together. Ctrl+C stops both.
set -e
cd "$(dirname "$0")"

for pkg in ui utils embed-react; do
  if [ ! -d "frontend/vendor/$pkg/dist" ]; then
    (cd "frontend/vendor/$pkg" && pnpm install && pnpm build)
  fi
done

trap 'kill 0' EXIT INT TERM

(cd backend && pnpm dev) &
(cd frontend && pnpm dev) &

wait
