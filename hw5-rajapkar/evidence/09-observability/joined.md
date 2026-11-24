# Joined: client sample `hw5t9-2611241626` and the API's request log

Joined on X-Request-Id. 4 API request lines parsed from origin-log.txt (4 JSON lines in all).
A row is joined to an origin line only when the origin logged that exact request id; a response answered by the edge alone has no origin line, and its X-Request-Id is the one stored with the cached copy.

| # | sent X-Request-Id | HTTP | edge | Age | client ms | origin ms | what happened |
|---|---|---|---|---|---|---|---|
| 1 | `hw5t9-2611241626-01` | 200 | MISS | - | 22743 | 49 | reached the origin: logged 200 in 49 ms |
| 2 | `hw5t9-2611241626-02` | 200 | HIT | 2 | 222 | — | edge only: answered with the copy stored from request #1 |
| 3 | `hw5t9-2611241626-03` | 200 | HIT | 4 | 66 | — | edge only: answered with the copy stored from request #1 |
| 4 | `hw5t9-2611241626-04` | 200 | EXPIRED | - | 278 | 36 | reached the origin: logged 200 in 36 ms |
| 5 | `hw5t9-2611241626-05` | 200 | HIT | 2 | 57 | — | edge only: answered with the copy stored from request #4 |
| 6 | `hw5t9-2611241626-06` | 200 | HIT | 4 | 49 | — | edge only: answered with the copy stored from request #4 |
| 7 | `hw5t9-2611241626-07` | 200 | MISS | - | 484 | 80 | reached the origin: logged 200 in 80 ms |
| 8 | `hw5t9-2611241626-08` | 200 | HIT | 2 | 106 | — | edge only: answered with the copy stored from request #7 |
| 9 | `hw5t9-2611241626-09` | 200 | HIT | 4 | 60 | — | edge only: answered with the copy stored from request #7 |
| 10 | `hw5t9-2611241626-10` | 200 | EXPIRED | - | 348 | 97 | reached the origin: logged 200 in 97 ms |
| 11 | `hw5t9-2611241626-11` | 200 | HIT | 2 | 61 | — | edge only: answered with the copy stored from request #10 |
| 12 | `hw5t9-2611241626-12` | 200 | HIT | 4 | 36 | — | edge only: answered with the copy stored from request #10 |

No origin lines with this run's prefix outside the client requests.

## Summary

| | value |
|---|---|
| requests sent | 12 |
| by Cloudflare cache status | MISS 2, HIT 8, EXPIRED 2 |
| reached the origin (joined) | 4 |
| client latency, ms (p50 / p95 / max) | 66 / 22743 / 22743 |
| origin latency from the API log, ms (p50 / p95 / max) | 49 / 97 / 97 |
| requests meeting the SLI's bar (200, valid body, ≤ 60 s) | 12 of 12 |

With 12 requests the p95 is simply the slowest request or close to it; treat these as a description of this sample, not a measured distribution.
