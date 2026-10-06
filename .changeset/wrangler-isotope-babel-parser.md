---
"wrangler": patch
---

Ship the Babel parser required by Wrangler's bundled TypeScript AST support

Wrangler now starts reliably from production-only installations after its bundled autoconfig code begins loading the TypeScript parser.
