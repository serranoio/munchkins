# Use cases

How a Munchkins run is expected to behave depends on **who is running it** and **what their tolerance for unattended risk is**. Five operator scenarios, ranked from most permissive to most defensive.

The integration mechanism (how an agent's branch lands on `main`) is intentionally not described here — that's an implementation detail. These rows describe the operator-facing behavior we expect to support; the implementation chooses the safest path that satisfies the chosen scenario.

## Scenarios

| Dimension | S1 — Hacker | S2 — Cautious | S3 — Overnight | S4 — Team / PR | S5 — Self-mod harness |
|---|---|---|---|---|---|
| **Operator** | Solo on a personal repo | Solo on a prod / shared repo | Nobody (cron, `/loop`, queue) | Branch-protected `main`, multiple writers | Any of the above, but the run edits the harness itself |
| **Watching the terminal** | yes | yes | no | no | varies |
| **Cost of a wrong landing** | `git revert` + 2 min | small but real | small per run, accumulates | rejected by branch protection | breaks every future run |
| **Lands directly on `main`** | ✓ | — (prepares branch) | ✓ | never | per the base mode |
| **Produces a PR** | — | optional | optional | required | — |
| **Conflict auto-resolution** | yes | trivial only; gate on semantic | yes | yes, against the PR target | yes |
| **Verification gates** | `DEFAULT_CHECKS` | `DEFAULT_CHECKS` | `DEFAULT_CHECKS` | `DEFAULT_CHECKS` | full suite (test + scenario + lint + typecheck) |
| **Fixer iteration cap** | 3 | 3 | 3 | 3 | 1 |
| **Concurrent runs safe** | — | — | flock-serialized | flock + per-PR | flock |
| **On unresolved failure** | preserve, loud terminal msg | preserve, surface the diff | notify hook, exit 0 (don't block queue) | leave PR with conflicts or preserve branch | preserve, escalate to human |
| **Operator contract** | "Land it if clean. Fail loud if not." | "Get it ready in one minute. Don't make me resolve conflicts." | "I'll read it in the morning. Don't lose data, don't deadlock." | "I review the code, I click merge. Anything else is the agent's job." | "Don't let an LLM patch the LLM-runner blind." |

## When each mode triggers

| Trigger | S1 | S2 | S3 | S4 | S5 |
|---|:---:|:---:|:---:|:---:|:---:|
| Default for foreground runs | ✓ | | | | |
| Operator opted in (`--gate=semantic`) | | ✓ | | | |
| `MUNCHKINS_UNATTENDED=1` set | | | ✓ | | |
| Repo has branch protection on `main` | | | | ✓ | |
| Conflicted file matches a danger glob¹ | | (upgrade) | | | (auto-upgrade from any base) |

¹ e.g. `packages/munchkins-core/**` — touching the harness auto-upgrades to S5's stricter verification + tighter cap, regardless of the chosen base mode.

## Status

| Mode | Wired today |
|---|:---:|
| S1 — Hacker | ✓ |
| S2 — Cautious | — |
| S3 — Overnight | — |
| S4 — Team / PR | — |
| S5 — Self-mod harness | — |

S2–S5 are designed to compose cleanly on S1's primitives (auto-resolve + verify + preserve-on-failure), so adding any of them later is additive, not a redesign.
