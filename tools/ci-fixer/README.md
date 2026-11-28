# CI fixer

When a workflow fails on a watched branch, find out whether a commit broke it.
If so, fix it straight on the branch, or revert the commit if there's no
verified fix. Either way, open an issue saying what happened.

- `.github/workflows/ci-fixer.yml` (in this repo): the reusable workflow.
- Each watched repo has its own small `.github/workflows/fix-failed-build.yml`
  that calls it when one of the repo's workflows fails. `install-callers.sh`
  writes those files.
- `set-claude-token.sh` stores the `CLAUDE_CODE_OAUTH_TOKEN` secret (from
  `claude setup-token`, Owen's subscription) in each repo.

## What it does

1. **Triage** (`triage.sh`, plain git, no AI). Skips runs on other branches
   (the watched branch is the default branch, or the Pages source branch for
   a Pages build) and runs that a later run, or a re-run of the same run,
   already fixed. Then compares the
   failed commit with the last commit that passed the same workflow, before
   the failure:
   - same commit, never passed, rewritten history, or only bot commits since:
     **diagnose** (not a regression: a service, a token, a flaky test)
   - commits by a person since: **fix**, with those commits as suspects
   - the failing commit is the fixer's own fix: **revert-fix**
2. **Claude Code** runs on the runner with only the Claude token: no GitHub
   token and no push credentials. In fix mode it reproduces the failure, makes
   the smallest fix, re-runs the failing commands until they pass and writes
   `result.json` (`prompt-fix.md`). In diagnose mode it changes nothing
   (`prompt-diagnose.md`).
3. **Apply** (`apply.sh`):
   - a verified fix that changes 20 files or fewer and nothing under
     `.github/` is committed (trailers `CI-fixer: fix` and
     `CI-fixer-suspects:`) and pushed straight to the branch;
   - a `not_regression` verdict (Claude ran the job on the current code and
     the suspects aren't at fault: a flake, a service, a token) changes
     nothing and opens a diagnosis issue, as diagnose mode does;
   - otherwise the offending commits are reverted in one commit
     (`CI-fixer: revert`) and pushed, unless the workflow has passed since
     (a re-run of the failed run, or a later run): then nothing is reverted
     and the issue says so;
   - then it re-runs the workflow (`workflow_dispatch`) or requests a Pages
     build, because pushes made with the workflow token don't start CI;
   - and opens an issue labelled `ci-fixer` (or comments on the open one with
     the same title).
   If the re-run of a fix fails, the next fixer run reverts the fix and the
   commits it fixed. It never acts on its own revert, so it can't loop.

## Limits

- Pushes use the workflow's own token, which GitHub doesn't allow to change
  files under `.github/workflows/`. So a regression in a workflow file can't
  be fixed or reverted by the fixer: it opens a "couldn't fix or revert"
  issue instead.
- A Pages (Jekyll) build can't be run on the runner. Claude fixes it from the
  log's error, file and line, and the Pages re-run is the check.

## Adding a repo

    tools/ci-fixer/set-claude-token.sh <repo>
    tools/ci-fixer/install-callers.sh <repo>

Rerun `install-callers.sh` after adding or renaming a workflow in a repo.
oat-web is skipped: oat-content's publish job replaces its whole contents, so
a caller there would be wiped; oat-content has its own.
Workflows should have a `workflow_dispatch:` trigger, so the fixer can re-run
them to confirm a fix.

## Testing

Triage against an old run:

    cd <clone of the repo>
    TRIAGE_IGNORE_LATER=1 REPO=owencorpening/<repo> RUN_ID=<id> CTX=/tmp/ctx \
      bash ~/dev/oat-tools/tools/ci-fixer/triage.sh

Apply locally, with your own git credentials and a hand-written
`$CTX/result.json`: set the env vars apply.sh lists, plus
`PUSH_URL=https://github.com/owencorpening/<repo>.git` and `GH_TOKEN=`.

Tested 2026-11-27 in a throwaway repo (ci-fixer-sandbox): a code regression
fixed and pushed, with CI re-run green; a broken Pages build fixed and
rebuilt; and the revert path, with a forced "cannot fix" verdict.

Tested 2026-11-28 against a scratch repo with a stub `gh`: `not_regression`,
and `cannot_fix` or `revert-fix` after a re-run or a later run passed, change
nothing; `cannot_fix` on a still-failing run still reverts.
