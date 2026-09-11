---
title: 'patchright ships its OWN TimeoutError class, so cross-package instanceof is always false'
slug: patchright-ships-its-own-timeouterror-class
type: finding
status: verified
created: 2026-09-11
source: 'Measured locally against the installed playwright 1.61.1 + patchright 1.61.1: `playwright.errors.TimeoutError === patchright.errors.TimeoutError` is false, and a timeout raised by a patchright-driven page satisfies only patchright instanceof. Reproduced as a standing guard in `packages/core/test/click-dispatch-fallback-engine-agnostic.test.ts`.'
---

## What is true

`patchright` is an API-compatible Playwright FORK, published as its own npm package
with its own bundled core. Its error classes are therefore DIFFERENT class objects
from `playwright`'s, even at identical versions:

```
playwright.errors.TimeoutError === patchright.errors.TimeoutError   // false
```

A timeout raised by a patchright-driven page satisfies
`err instanceof patchright.errors.TimeoutError` and FAILS
`err instanceof playwright.errors.TimeoutError`. Both set `err.name === 'TimeoutError'`,
so a structural check on the NAME works across both, while class identity cannot.

The same applies to every other error class either package exports, and to any
future fork of this kind.

## Why it matters here

webhands imports `playwright` directly and loads `patchright` lazily only when
`--stealth` is opted in. Any `instanceof` against a `playwright` class is therefore
silently false in stealth mode, which is the mode users reach for when a site fights
back, and the failure is invisible: no log, no type error, just a branch that stops
being taken.

## Standing rule

**Never branch on `instanceof` for a class that may come from the optional stealth
fork.** Use a structural predicate (`err.name === 'TimeoutError'`), and keep it in one
place so the brittleness is confined and testable. Any future Playwright-error branch
in this repo must go through such a predicate.

Related external fact, same class of trap: Playwright's `dispatchEvent` signature is
`dispatchEvent(type, eventInit?, options?)`, so a `{timeout}` passed as the SECOND
argument silently becomes an event FIELD and the 30s default applies. It also merges
`{bubbles: true, cancelable: true, composed: true}` into the init and builds a real
`MouseEvent` for `click`, which is why a dispatched click still runs HTML activation
behaviour and toggles a hidden radio or checkbox.
