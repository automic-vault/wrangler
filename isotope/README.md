# Wrangler Isotope

This fork integrates Wrangler with Automic Vault. Its security vocabulary and
boundaries follow the canonical [domain language](https://github.com/automic-vault/automic-vault/blob/main/docs/domain-language.md)
and [architecture](https://github.com/automic-vault/automic-vault/blob/main/docs/architecture.md).

Upstream baseline: Cloudflare Workers SDK commit
`8bbcb9f08bcfaa291c7d28b6884fc88c1264bb84`, Wrangler 4.129.0.

## Runtime boundary

Like the `gh` Isotope, the credential-consuming executable must be the signed
Gate Client and Target. A native addon loaded by an arbitrary Node executable
is insufficient: the addon does not authenticate the JavaScript that called it.
The intended distribution is a pinned Node single-executable application with
an embedded entry point, disabled external Node options, and authenticated
runtime resources. npm entry points can delegate to this installation; they
cannot grant a project-local Wrangler authority to retrieve its credentials.

OAuth storage must keep the entire credential, including the refresh token,
in Automic Vault custody. Reads require a complete Authorization Request;
missing credentials must be distinguished from denial and transport failure.
Login and refresh must persist through approved Secret mutation operations.
There must be no fallback to plaintext or `/usr/bin/security` after a Vault
error. Explicit environment credentials remain outside Vault custody.
