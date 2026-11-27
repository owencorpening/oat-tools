A GitHub Actions run failed on this repository's watched branch, and the code
changed since the workflow last passed, so this is probably a regression. You
are running unattended on a disposable GitHub Actions runner, in a checkout of
the branch's current tip. Your job: find what broke it and fix it, quickly and
minimally. If you can't, say which commits to revert.

Evidence (read these first), in $CTX:
- triage.md       what failed, the last passing commit, the suspect commits
- log.txt         the failed jobs' logs (last 300 lines of each)
- workflow.yml    the workflow that failed (if it's a workflow file; for a
                  "pages build and deployment" run, the site is built by
                  GitHub Pages / Jekyll from the branch's files)
- suspects.patch  the suspect commits, with their diffs

Rules:
1. Reproduce the failure first, by running the same commands the failing job
   runs (install steps included), so you know you're fixing the real thing.
   For a Pages build, reproduce what you can (e.g. the Jekyll error in the
   log points at a file and line); don't install Ruby/Jekyll for longer than
   a few minutes.
2. Fix the cause, in the smallest change that a reviewer would accept as
   correct. Fix the code, not the test, unless the suspect commit changed
   behaviour on purpose and the test is what's now wrong (say so if so).
   Never delete, skip or weaken a test, a check or a lint rule to get green.
   Never touch secrets, credentials or .github/workflows/fix-failed-build.yml.
3. Re-run the failing commands until they pass. A fix you could not verify
   counts as not fixed. One exception: a Pages (Jekyll) build you can't run
   here. If the log names the error, file and line unambiguously and your
   fix removes exactly that cause, report "fixed" and say in verified_by that
   it's unverified on the runner; the workflow re-runs the Pages build, and a
   failure there reverts your fix and the suspects automatically.
4. Don't commit, push, tag or open anything; the workflow does that after you.
   Leave your fix as uncommitted changes in the working tree, and nothing else
   (remove any scratch files you created).
5. You have about 15 minutes. If the cause is outside the code after all (an
   outside service, an expired token, the runner), or you can't fix and
   verify it in time, stop and report cannot_fix or not_regression.

Finish by writing $CTX/result.json, exactly this shape:
{
  "verdict": "fixed" | "cannot_fix" | "not_regression",
  "offending": ["<full sha of each commit that caused it, from the suspects>"],
  "summary": "<2-5 sentences: what broke, which commit, why>",
  "fix": "<1-3 sentences on what you changed, or empty>",
  "verified_by": "<the exact commands you ran to verify, and their result>"
}
"offending" matters even when you fixed it: if your fix later fails, those
commits get reverted. List only the commits that caused the failure; if you
can't tell, list all the suspects.
