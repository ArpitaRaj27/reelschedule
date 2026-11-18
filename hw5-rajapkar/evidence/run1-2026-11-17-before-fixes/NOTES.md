# Run 1 (2026-11-17 ~19:58 UTC): kept as "before" evidence

Captured by `scripts/capture-cache-states.ps1` at commit 8ae439e. Two problems found in this run:

1. **Cloudflare overrode the browser TTL.** The origin sends `Cache-Control: public, max-age=0, s-maxage=10`
   for public API reads, but responses through the zone arrived as `public, max-age=14400, s-maxage=10`
   (see `03-headers/miss.txt`, `hit.txt`). Cause: the zone's *Browser Cache TTL* setting (default 4 h)
   raises any lower origin max-age. Effect: a browser could reuse an API response for 4 hours instead
   of revalidating, defeating the 10 s freshness design.
2. **The 304 step was a false negative caused by the script, not the server.** Windows PowerShell 5.1
   strips the inner quotes of the weak ETag `W/"..."` when passing `-H "If-None-Match: ..."` to
   curl.exe, so Cloudflare received a non-matching validator and answered 200 (`03-headers/304.txt`).
   The same conditional request from a browser returned 304 (HIT).

Also note for the purge evidence: the before-purge HIT was served by the DFW PoP, the after-purge MISS by MAN
(CF-RAY suffix). PoP caches are independent, so a MISS at a different PoP proves nothing on its own.

## Fixed before run 2 (2026-11-18 ~17:57 UTC)

- Browser Cache TTL set to **Respect Existing Headers** in the Cloudflare dashboard. Run 2 shows `public, max-age=0, s-maxage=10`.
- The 304 step now uses `curl --etag-save` / `--etag-compare`, so curl stores and replays the ETag itself. Run 2 shows `304 Not Modified`, 0 bytes.
- The purge before/after requests in run 2 were both answered at CMH.
