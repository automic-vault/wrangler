---
"wrangler": patch
---

Fix the Wrangler Isotope rejecting macOS's read-only root filesystem

Treat a read-only filesystem as a denied write while retaining ownership, permission, and signature checks. Give the native credential client a relative library identifier so the Homebrew formula can preserve the signed bundle.
