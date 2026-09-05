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

## Building

The macOS arm64 Isotope requires macOS Sonoma (14) or later.

Use pnpm 10.33.0 and the official Node 26.8.1 distribution for the SEA builder
(Homebrew Node disables SEA). Install the pinned workspace dependencies with
`pnpm install --frozen-lockfile`, then run:

```sh
CODESIGN_IDENTITY='Developer ID Application: …' node isotope/build.mjs
```

The output is `isotope/out/cli-4.129.0.tgz`, containing `Wrangler.app` with
its Node runtime, native XPC client, Wrangler and runtime dependencies. The
build uses the workspace lockfile for deployment and verifies the complete
bundle signature. `automic-vault.yml` describes the fork-owned build.

## Integration status

The matching app changes register the `wrangler` Secret Gate and restrict
mutations to the `WRANGLER_AUTH_` namespace. OAuth credentials currently use
Global Values only; a Project Value fails closed because refresh does not yet
bind its mutation to the selected source. All credential uses currently
require Approval, including credential inspection and operations that might
run project code. No read/write command policy is inferred from command names.

The runtime expects a root-owned installation at
`/opt/av/wrangler/Wrangler.app`, with no group or other write permission on
resources or ancestor directories. It refuses user-writable installations,
modified signatures, and resource links outside the bundle. The macOS npm
`wrangler` and `wrangler2` entry points delegate to that exact runtime and never
receive its credential through stdout or environment injection.

Install with `brew install automic-vault/isotopes/wrangler-isotope`, then run
`av harden wrangler` to verify and protect the runtime. Re-run the Hardener
after Homebrew upgrades. Without Homebrew, the Hardener verifies and installs
the same fork archive directly. No `.pkg` installer is used.

Before switching, log out with each upstream auth
profile to revoke and remove its credentials, then log in through the signed
Isotope. Installing the Isotope alone does not resolve an existing Detector
Finding. Library API consumers, Vite, Vitest and `cf-wrangler` do not inherit
the signed runtime's credential authority.
