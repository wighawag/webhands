---
title: Frame-aware `query` read + same-origin token-harvest captcha proof
slug: frame-aware-query-token-harvest-captcha-proof
prd: broaden-agent-verb-surface
blockedBy: [query-and-state-verbs]
covers: [6, 7]
---

## What to build

Prove the captcha CAPABILITY BAR for the token-harvest family using ONLY verbs:
an agent with its own 2captcha key (provided/simulated in the test) can get past a
same-origin captcha by poking the page, with NO pre-built solver and NO iamhuman.

The spike already proved DELIVERY works through existing verbs (`type` the token
into a same-origin frame sink, fire the callback via `eval`/`click`); the one gap
was a frame-aware READ of the sitekey. That read is the `query` verb from
`query-and-state-verbs` addressing a same-origin child frame via a
`frameLocator(...)` locator expression (R1: frame scope rides in the locator
string; no new verb). This task VERIFIES that path end to end and adds the
fixture + test that demonstrates the full token-harvest loop:

1. `query` reads the sitekey from a same-origin `#main-iframe`
   (`frameLocator('#main-iframe').locator('.h-captcha')` + `attrs:['data-sitekey']`).
2. The agent obtains a token out of band (the test FAKES the 2captcha provider —
   no real network, no real key; webhands ships no solver/key).
3. `type` writes the token into the same-origin response-sink textarea (addressed
   via the same frame hop).
4. The callback is fired (`eval`/`click`) and the page advances.

This is a PROOF (fixture + test), not new product surface beyond confirming the
frame-aware `query` read. If, in building it, the existing locator resolver does
NOT in fact carry a same-origin `frameLocator` read for `query` the way it does
for `click`/`type`, that is the real work: make `query`'s read go through the same
frame-capable resolver (still no new addressing scheme).

## Acceptance criteria

- [ ] A local SAME-ORIGIN nested-frame fixture carries a `.h-captcha[data-sitekey]`
      + a response-sink `<textarea>` + a page callback in a child `#main-iframe`
      (build the structure described in
      `work/notes/findings/click-and-type-already-frame-scoped-via-framelocator.md`).
- [ ] `query` reads the sitekey from the child frame via a `frameLocator(...)`
      locator expression (no `--frame` flag; frame scope is in the locator).
- [ ] The full token-harvest loop passes using ONLY verbs (`query` read -> token
      from a FAKE provider -> `type` into the sink -> fire callback) and the
      fixture page advances; no real 2captcha network call, no real key, no
      iamhuman dependency.
- [ ] The proof exercises NO solver code in webhands (webhands ships none); the
      "provider" is a test fake.
- [ ] Tests are real-browser + local fixture seam tests (mirror the repo style).
- [ ] Shared-write isolation: profile paths point at per-test temp dirs; the real
      `~/.webhands` is untouched.
- [ ] A changeset is added if any product code changed (a pure test/fixture
      addition still follows the repo's changeset convention if it applies).

## Blocked by

- `query-and-state-verbs` — uses that task's `query` verb (its frame-capable
  read) as the sitekey reader.

## Prompt

> Goal: prove the token-harvest captcha capability bar using ONLY webhands verbs —
> an agent with its own (test-faked) 2captcha key gets past a same-origin captcha
> by poking the page, no pre-built solver, no iamhuman. Deliverable from the prd
> `work/prds/tasked/broaden-agent-verb-surface.md` (User Stories 6, 7).
>
> READ FIRST: `work/notes/findings/click-and-type-already-frame-scoped-via-framelocator.md`
> (the spike: `click`/`type` already reach same-origin frames via `frameLocator`,
> and the ONLY same-origin captcha gap was a frame-aware READ) and
> `work/notes/findings/playwright-cross-origin-frame-captcha-mechanics.md` (the
> Imperva structure: sitekey + token sink are same-origin in `#main-iframe`; only
> the TILES are cross-origin, which is Tier-4, NOT this task).
>
> CHECK REALITY: the `query-and-state-verbs` task must have landed. Confirm its
> locator resolution carries a same-origin `frameLocator(...)` read for `query`
> just as `click`/`type` already do; if it does not, making `query`'s read
> frame-capable through the SAME single resolver is part of this task (no parallel
> addressing scheme — R1).
>
> Domain vocabulary: **token-harvest captcha family** = read the page-readable
> sitekey, get a provider token, inject it into the same-origin response sink,
> fire the callback (vs the vision/tile family, which needs cross-origin tile
> clicks — Tier-4, out of scope here). webhands SHIPS NO SOLVER OR KEY — the agent
> brings them; in the test, FAKE the provider (no real network, no real key).
>
> What "done" means: a same-origin nested-frame fixture (sitekey + sink + callback
> in `#main-iframe`); `query` reads the sitekey through a `frameLocator` locator
> expression; the full loop (read -> fake token -> `type` into sink -> fire
> callback -> page advances) passes with verbs only; real-browser fixture tests;
> profile paths isolated to temp; a changeset if product code changed. The vision/
> tile cross-origin family is explicitly NOT in scope (that is Tier-4).
