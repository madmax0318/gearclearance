#!/bin/sh
# Manual ruleset check. This script prints the checks. It does not change repository settings.
set -eu

cat <<'EOF'
Manual ruleset verification
- Default branch rejects direct pushes.
- Pull requests require a review from the code owner.
- Bots cannot merge and cannot approve their own pull requests.
- A bot pull request is limited to deal rows, the expired archive, and deal images.
- Required status checks include the test-build, bot-paths, and check-bot-diff jobs.
- Auto-merge stays off.
EOF

if [ -n "${GH_TOKEN:-}${GITHUB_TOKEN:-}" ]; then
  echo "A token is present. This script still does not call the API and does not change settings."
fi
