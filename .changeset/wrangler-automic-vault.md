---
"wrangler": minor
"@cloudflare/workers-auth": minor
---

Add the macOS Automic Vault Isotope credential store

The fork's npm entry point delegates to a fixed signed Wrangler runtime.
OAuth access and refresh tokens use Automic Vault custody; denial cannot
fall back to plaintext or the upstream keyring. Other platforms are unchanged.
