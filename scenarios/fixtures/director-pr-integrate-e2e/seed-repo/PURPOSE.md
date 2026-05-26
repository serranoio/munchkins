# Purpose — director-pr-integrate-e2e fixture

Synthetic north star for the director Foreman (`--integrate=pr`) scenario.

## Success criteria

All criteria are intentionally already satisfied; the triage step is mocked to
emit an idle short-circuit so the dispatch step exits 0 without invoking a
child munchkin. This lets the scenario assert the director's *own* integration
boundary (push + `gh pr create`) without exercising real dispatch.
