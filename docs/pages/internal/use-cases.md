# Use cases

How a Munchkins run is expected to behave depends on **who is running it** and **what their tolerance for unattended risk is**. The five scenarios below describe the realistic operator contexts. They are ranked from most permissive to most defensive.

The integration mechanism (how an agent's branch lands on `main`) is intentionally not described here — that's an implementation detail. These scenarios describe the operator-facing behavior we expect to support; the implementation chooses the safest path that satisfies the chosen scenario.

---

## S1 — Hacker mode

**Operator.** Solo developer working on a personal repo. They are watching the terminal while the agent runs. Cost of a wrong landing is roughly two minutes of `git revert` plus a re-run.

**Expected behavior.**
- Agent passes its checks → its work lands on `main`. No prompts, no review, no PR.
- Conflicts encountered during integration are resolved automatically and verified against the same gates the agent had to pass. Pass = land. Fail = preserve the run for inspection, with a loud terminal message and a usable artifact directory.

**The contract.** "Land it if it's clean. If it's not, fail loud and let me investigate."

---

## S2 — Cautious mode

**Operator.** Same human, but the repo ships to production or to teammates. They trust automation for trivial conflicts and refactor-class work, but want a final human eye before anything semantic touches `main`.

**Expected behavior.**
- Agent passes its checks → the work is **prepared** for landing on `main` but does not land. The operator gets a clean branch + a one-line summary, runs `git diff main...<branch>`, eyeballs it, and merges by hand.
- The same automation as S1 still attempts to resolve conflicts so the prepared branch is in a directly-mergeable state — humans review code, not conflict markers.

**The contract.** "Get to the point where I can decide in one minute. Don't make me resolve conflicts."

---

## S3 — Overnight batch

**Operator.** Nobody. The agent was launched on a schedule, by a `/loop`, or as part of a queue of independent runs. There is nothing to interrupt.

**Expected behavior.**
- Behaves like S1 for individual runs, but a failed run **must not block subsequent runs**. A queued or scheduled successor starts cleanly even after a predecessor preserved its worktree.
- Concurrent runs serialize on a known coordination point so two simultaneous integrations don't trample each other. A loser quietly retries.
- On unresolved failure, the operator receives a notification (terminal, file, Slack, desktop — operator choice) describing what happened and where to look.

**The contract.** "I'll read it in the morning. Don't lose data, don't deadlock, don't fail silently."

---

## S4 — Team / PR-required

**Operator.** A repo with branch protection on `main`. Direct pushes are rejected; landing requires a reviewed pull request. Multiple humans plus other agents are concurrent writers.

**Expected behavior.**
- Agent never modifies `main` directly. Its work is published as a branch and a pull request, with the summary writer's commit message as the title and the run's markdown as the body.
- Conflict resolution still runs against the PR's target branch, so the resulting PR is in a **mergeable** state when a human opens it. Reviewers should never have to resolve conflicts; they review code.
- A failed run produces a draft PR (or a preserved branch with no PR), so the artifact is still discoverable.

**The contract.** "I review the code, I click merge. Anything else is the agent's job."

---

## S5 — Self-modifying harness

**Operator.** Any of the above, but the agent is editing the harness itself — the framework code that runs all subsequent agent runs. Today's example: an agent run that touches `packages/munchkins-core/`.

**Expected behavior.**
- Conflicts in harness paths get **stricter verification** than ordinary edits: the full check suite must pass, not just the lightweight gates. A subtly broken harness ships subtly broken every future run, so the bar is higher.
- Automatic conflict-resolution is allowed but **capped harder** — fewer attempts before falling back to "preserve, notify human."
- The check upgrades trigger automatically when any conflicted file matches a configured danger glob; the operator never has to remember to flip a switch.

**The contract.** "Don't let an LLM patch the LLM-runner blind."

---

## How these compose

The five scenarios are independent dimensions, not exclusive modes:

| operator dim                    | S1 | S2 | S3 | S4 | S5 |
|---------------------------------|----|----|----|----|----|
| watching the terminal           | ✓  | ✓  |    |    |    |
| can land directly on main       | ✓  |    | ✓  |    | ✓¹ |
| produces a PR                   |    | ✓² | ✓² | ✓  |    |
| concurrent-run safe             |    |    | ✓  | ✓  |    |
| harness-edit aware              |    |    |    |    | ✓  |
| auto-resolves conflicts         | ✓  | ✓  | ✓  | ✓  | ✓  |
| preserves on unresolved failure | ✓  | ✓  | ✓  | ✓  | ✓  |

¹ Only when the chosen base mode is direct-merge.
² Optional — the operator picks PR or local branch.

Today's default is S1. The other scenarios are designed to compose cleanly with S1's primitives (auto-resolve + verify + preserve-on-failure) so adding any of them later is additive, not a redesign.
