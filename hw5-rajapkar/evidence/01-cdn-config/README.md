# Cloudflare configuration export: zone miniexhibit.app

Exported 2026-11-19 22:51:53 UTC. Zone id 7e3ca644c5330c3a0dc02b2e0be843c5, plan "Free Website", status active.

| File | Cloudflare API v4 endpoint (GET) | What it is |
|---|---|---|
| `dns-zone.txt` | `/zones/{zone}/dns_records/export` | Cloudflare's own BIND export of every DNS record |
| `cache-rules.json` | `/zones/{zone}/rulesets/phases/http_request_cache_settings/entrypoint` | the Cache Rules ruleset (1 rule) |
| `zone-settings.json` | `/zones/{zone}/settings` (filtered) | the settings caching and TLS depend on |

How: the same three GET requests as `scripts/export-cloudflare-config.ps1`, made through my signed-in Cloudflare
dashboard session in the desktop app's browser pane (the AI assistant ran them at my request; read-only; no API token
was created, so none had to be deleted). The JSON bodies are saved as returned, pretty-printed; `zone-settings.json`
keeps only the 10 settings listed in the script. To reproduce with a token instead, follow the comment at the top of
`scripts/export-cloudflare-config.ps1`.

## Change on 2026-11-19 (after the first export)

The first export (22:51:53 UTC, kept as `zone-settings-before-2026-11-19.json`) showed two gaps:

| Setting | Before | After | Why |
|---|---|---|---|
| `always_use_https` | off | **on** (22:54:48 UTC) | a client that does send `http://` (curl, scripts, bots) got the page over plain HTTP instead of a redirect. Browsers never send `http://` here: `.app` is on the browsers' HSTS preload list. The final project's D2 asks for an HTTP→HTTPS redirect regardless |
| `min_tls_version` | 1.0 | **1.2** | TLS 1.0/1.1 are deprecated (RFC 8996) |

Changed in the dashboard (SSL/TLS > Edge Certificates) with my approval; `zone-settings.json` is the re-export at
22:55:27 UTC. The site answered 200 and `/healthz` ok right after. Cloudflare reports `modified_on: null` for
`min_tls_version` even though the value changed. Redirect proof: `http-redirect.txt`.

Secrets: none. The TXT record is the course domain-ownership marker; it is public in DNS by design.
