# Operations notes

`check-bot-diff` must be a required status check.

The bot App must never get the Workflows permission.

`pull_request` runs the workflow file from the pull request head, so Code Owner review of `/.github/` and `/scripts/` is the real control on that workflow.
