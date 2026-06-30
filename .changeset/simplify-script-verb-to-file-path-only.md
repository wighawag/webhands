---
'webhands': major
---

BREAKING: the `script` verb now takes its JS source EXACTLY ONE way: a FILE-PATH positional. `npx webhands script ./flow.js` is the only form; the verb reads that path and runs its contents.

- **Inline source, `--file`, and stdin are REMOVED.** The old three-source design (`script "<js>"` inline OR `script --file ./flow.js` OR `cat flow.js | script`) is gone. There is now ONE source, ONE rule: the positional argument is a PATH to a JS file.
- **A bare `webhands script` (no path) fails loud** (the positional is required), and a **missing/unreadable path fails loud** with a typed, non-cryptic error that names the path (the `invalid-script` error code shape is preserved).
- **WHY:** one source, one rule. The file-first workflow is exactly what a raw-Playwright agent already writes (a flow file, then run it), so making it the only workflow removes the redundant `--file` flag and the "three ways to do one thing" surface, and keeps the `script`-vs-Playwright comparison honest.
- **UNCHANGED:** the driver-context semantics (the full live Playwright `page`, real locators + actions + auto-waiting) and the ADR-0003 seam-clean, serializable RETURN. Only HOW the source is supplied changed. `eval` is untouched.
- The `readScriptStdin`/`readProcessStdin`/`resolveScriptSource` multi-source machinery was removed (no dead code), replaced by a single `readFile(path, 'utf8')` at the call site. ADR-0012 is amended accordingly.
