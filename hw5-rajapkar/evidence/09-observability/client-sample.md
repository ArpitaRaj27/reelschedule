# Client-side sample: GET https://reel.miniexhibit.app/api/status

Run `hw5t9-2611241626`, 2026-11-24T16:26:52.233Z to 2026-11-24T16:29:17.866Z (UTC). Anonymous requests, 4 bursts of 3, bursts 35 s apart.
`edge` is Cloudflare's `cf-cache-status`; `app` is the API's own in-process cache (`X-Cache`) as recorded on the response that was served.

| # | burst | sent X-Request-Id | HTTP | client ms | edge | Age | app | returned X-Request-Id | cf-ray |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 1 | `hw5t9-2611241626-01` | 200 | 22743 | MISS | - | MISS | `hw5t9-2611241626-01` | a5f9c7606b1d36d9-YYZ |
| 2 | 1 | `hw5t9-2611241626-02` | 200 | 222 | HIT | 2 | MISS | `hw5t9-2611241626-01` | a5f9c7f9ed9f36d9-YYZ |
| 3 | 1 | `hw5t9-2611241626-03` | 200 | 66 | HIT | 4 | MISS | `hw5t9-2611241626-01` | a5f9c807ef6c36d9-YYZ |
| 4 | 2 | `hw5t9-2611241626-04` | 200 | 278 | EXPIRED | - | MISS | `hw5t9-2611241626-04` | a5f9c8e3eecc164a-YYZ |
| 5 | 2 | `hw5t9-2611241626-05` | 200 | 57 | HIT | 2 | MISS | `hw5t9-2611241626-04` | a5f9c8f17a8e164a-YYZ |
| 6 | 2 | `hw5t9-2611241626-06` | 200 | 49 | HIT | 4 | MISS | `hw5t9-2611241626-04` | a5f9c8fe5f12164a-YYZ |
| 7 | 3 | `hw5t9-2611241626-07` | 200 | 484 | MISS | - | MISS | `hw5t9-2611241626-07` | a5f9c9d9cf4a452a-CMH |
| 8 | 3 | `hw5t9-2611241626-08` | 200 | 106 | HIT | 2 | MISS | `hw5t9-2611241626-07` | a5f9c9e90c6c452a-CMH |
| 9 | 3 | `hw5t9-2611241626-09` | 200 | 60 | HIT | 4 | MISS | `hw5t9-2611241626-07` | a5f9c9f63ac9452a-CMH |
| 10 | 4 | `hw5t9-2611241626-10` | 200 | 348 | EXPIRED | - | MISS | `hw5t9-2611241626-10` | a5f9cad1cfbaa241-YYZ |
| 11 | 4 | `hw5t9-2611241626-11` | 200 | 61 | HIT | 2 | MISS | `hw5t9-2611241626-10` | a5f9cae02cb2a241-YYZ |
| 12 | 4 | `hw5t9-2611241626-12` | 200 | 36 | HIT | 4 | MISS | `hw5t9-2611241626-10` | a5f9caed28aba241-YYZ |
