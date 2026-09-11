---
'webhands': minor
'@webhands/core': minor
---

**`script` accepts the module-style file a human actually writes.** The loader compiled the source by wrapping it in an expression position (`return (<source>)`), so a trailing semicolon failed with `Unexpected token ';'` and a top-level `const CONFIG = {...}` before the function failed with `Unexpected token 'const'`: messages that name the punctuation and never the cause. The ADR-0012 contract is unchanged (the file's VALUE is the function), but the compile now lives in `script-source.ts` and accepts top-level statements before the final function expression, a trailing semicolon, and a leading `export default`. ESM `import` and `module.exports` still cannot work, and both now arrive at `InvalidScriptSourceError`, which states the constraint, shows a correct minimal example and lists what IS tolerated.

A minor rather than a patch because it widens the set of accepted `script` sources, which is a new capability (documented as one in the skill and the verb's own help), not a bug fix.

Compile and invoke are separated so a RUNTIME `SyntaxError` in the caller's own script (`JSON.parse('{')`, `new RegExp('[')`, a nested `eval`) is no longer mistaken for a parse failure. Previously such a script was re-run from the top, so its side effects happened TWICE, and the author was then shown a shape complaint instead of their own parse error.

New exports from `@webhands/core`: `compileScriptSource`, `InvalidScriptSourceError`, `ScriptSourceBindings`.
