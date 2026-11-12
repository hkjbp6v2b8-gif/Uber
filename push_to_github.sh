#!/usr/bin/env bash
# Usage: ./push_to_github.sh https://github.com/YOUR_USER/YOUR_REPO.git
set -e
REPO_URL="$1"
if [ -z "$REPO_URL" ]; then echo "usage: $0 <github-repo-url>"; exit 1; fi
cd "$(dirname "$0")"
[ -d .git ] || git init -b main
git add .
git commit -m "Initial commit: ride-hailing backend, rider app, driver app, admin panel" || true
git remote remove origin 2>/dev/null || true
git remote add origin "$REPO_URL"
git push -u origin main
