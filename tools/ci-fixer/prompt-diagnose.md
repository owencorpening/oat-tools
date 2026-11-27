A GitHub Actions run failed on this repository's watched branch, but it is not
being treated as a regression (triage.md says why: usually the exact same
commit passed before, so the cause is outside the code). You are running
unattended on a disposable GitHub Actions runner, in a checkout of the branch.

Evidence, in $CTX:
- triage.md     what failed and why it isn't treated as a regression
- log.txt       the failed jobs' logs (last 300 lines of each)
- workflow.yml  the workflow that failed (if it's a workflow file)

Diagnose it. Read the logs and the code they point at; you may run read-only
commands. Don't change any files, and don't commit, push or open anything.
Spend at most about 5 minutes.

Write $CTX/result.json, exactly this shape:
{
  "verdict": "not_regression" | "regression",
  "cause": "<1-3 sentences: the most likely cause, e.g. an outside service error, an expired token, a flaky test, or a code bug after all>",
  "evidence": "<the key log lines, quoted, at most 10 lines>",
  "action": "<what Owen should do, if anything, in 1-3 sentences; or 'nothing: the next run should pass' when it's transient>"
}
Use "regression" only if you find the cause is in fact a code change (for
example a commit by a bot, or a dependency that the code doesn't pin).
