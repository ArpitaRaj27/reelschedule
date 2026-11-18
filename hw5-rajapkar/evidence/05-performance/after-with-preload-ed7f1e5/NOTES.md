# First "after" runs: commit ed7f1e5 (CLS fix + `/api/meta` preload)

Captured 2026-11-18 20:43–20:46 UTC with `scripts/lighthouse.ps1 -Label after` (simulated) and
`-Label after -Throttling devtools`, against https://reel.miniexhibit.app/ while `/healthz` reported commit `ed7f1e5`.

| Mode | Scores | LCP (ms) | CLS | Median (by LCP) |
|---|---|---|---|---|
| simulated | 86 / 92 / 90 | 3062 / 2715 / 2913 | 0.011 / 0 / 0 | run 3 |
| devtools | 88 / 80 / 61 | 2909 / 2805 / 4976 | 0.021 / 0.021 / 0.021 | run 1 |

What made these runs a separate record instead of the final "after":

- Simulated LCP came out 415–485 ms later than simulated FCP in all three runs (before the change, LCP equalled FCP in 2 of 3 runs),
  and the simulated median LCP went from 2110 ms (before) to 2913 ms, over the 2.5 s budget.
- The times Lighthouse actually observed on the unthrottled load did not get worse: observed FCP = LCP = 917 / 717 / 696 ms
  (before: 591 / 939 / 506 ms). So the increase came from the simulation, not the page.
- Suspect: the `<link rel="preload" href="/api/meta">` added in ed7f1e5, which puts one more request ahead of the first paint.

Check (run in the AI assistant's sandbox, not on this machine: local server, same JavaScript build, only `index.html` differs,
runs alternating with/without the preload):

| Mode | With preload | Without preload |
|---|---|---|
| simulated, 5 runs each | LCP 3418–3793 ms (median 3613) | LCP 3202–3270 ms (median 3231) |
| devtools, 3 runs each | LCP 3584–3620 ms, CLS 0.001 | LCP 3521–3643 ms, CLS 0.001 |

The program page starts all of its queries in parallel when it mounts, so the list waits for `/api/screenings` either way;
the preload only started `/api/meta` earlier. It was removed in the next commit. The final "after" runs in the parent folder
are the production comparison.
