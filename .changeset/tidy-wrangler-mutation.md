---
"wrangler": patch
---

Fix Wrangler Isotope credential mutations missing their working directory

Include the current working directory in native credential save and delete requests so login, token refresh, and logout can reach Automic Vault's existing Approval flow.
