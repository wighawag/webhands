---
title: Rename the seam `Page` type to `WebHandsPage` (kill the Playwright-`Page` name collision)
slug: rename-seam-page-to-webhandspage
---

> Launch snapshot — records intent at creation, NOT maintained. Current truth: `docs/adr/` (decisions) + the code; remaining work: `work/tasks/` tasks.
>
> Tasked — the implementation/testing detail now lives in the task `work/tasks/ready/rename-seam-page-to-webhandspage.md`; the durable WHY is recorded as an ADR at build time (story 10). This PRD has settled to its durable framing.

## Problem Statement

webhands' verb-level seam type is named `Page` (`packages/core/src/seam.ts`): a deliberately small, transport-neutral 8-verb interface (`navigate`, `snapshot`, `click`, `type`, `eval`, `wait`, `cookies`, `setCookies`) with branded-locator-string addressing and a hard rule that NO Playwright/CDP type may cross it (ADR-0003). It is NOT Playwright's `Page` — it is an abstraction OVER whatever transport (Playwright launch/attach today; a future Firefox or extension transport) drives the browser.

But the name `Page` collides head-on with Playwright's own `Page`, and the collision is not hypothetical — it already forces an alias in the code and it actively misleads readers:

- `hand-host.ts` and the two Playwright transports must import the REAL Playwright page as `type Page as PwPage` PURELY to dodge the clash with the seam `Page` they also import from `./seam.js`. The existence of the `PwPage` alias is the tell that `Page` was the wrong name for the seam type.
- The collision caused a real, expensive misread during the iamhuman-hand design conversation: a reader (reasonably) assumed `HandContribution.verbs: Partial<Page>` meant "a partial of Playwright's giant `Page`" and worried a hand had to implement a huge surface, when it actually means "a subset of webhands' 8 seam verbs" — a small, sensible thing. The name, not the design, generated the confusion.

This is a NAMING defect on COMMITTED PUBLIC SURFACE (`Page` is exported from `packages/core/src/index.ts`; ADR-0007 froze the hand contract that references it). The seam abstraction itself is fine; only its name lies.

## Solution

Rename the seam type `Page` → `WebHandsPage` throughout `core`, and drop the now-unnecessary `type Page as PwPage` aliases (the Playwright page can just be imported as `Page` once the seam type no longer claims that name). NOTHING about behaviour, the verb set, the wire protocol, the hand contract semantics, or the trust model changes — this is a pure rename for honesty/ergonomics.

After the rename:

- `WebHandsPage` is unmistakably webhands' own abstraction; `Page` (where used) is Playwright's real one, imported without an alias.
- `HandContribution.verbs: Partial<WebHandsPage>` now READS correctly: a hand contributes a subset of webhands' 8 seam verbs (built-in hands), and a third-party hand additionally carries its own dynamically-named verbs on the same object exactly as today (the tested `{verb:'hand', name, args}` RPC path is UNCHANGED).
- The `HandContext.pwPage` field stays `pwPage` (the live Playwright page a hand operates in-process) — its TYPE annotation simplifies from `PwPage` back to plain Playwright `Page`.

This is a BREAKING change to the exported type name, shipped as one major bump with a changeset. webhands is its own only consumer today (iamhuman's hand adapter is not built yet), so the migration cost is a single, controlled rename now — the cheapest it will ever be.

## User Stories

1. As a webhands maintainer, I want the seam verb-interface renamed `Page` → `WebHandsPage`, so it can never again be mistaken for Playwright's `Page`.
2. As a webhands maintainer, I want every `core` source reference to the seam type updated, so the build stays green and no stale `Page` reference to the seam type remains.
3. As a webhands maintainer, I want the `type Page as PwPage` aliases (in `hand-host.ts` and the two Playwright transports) DROPPED in favour of importing Playwright's `Page` directly, so the only reason that alias existed (the name clash) is gone and the live-page type reads plainly.
4. As a webhands maintainer, I want `WebHandsPage` exported from `packages/core/src/index.ts` in place of `Page`, so the public authoring surface uses the honest name.
5. As a third-party hand author (iamhuman, imminently), I want `HandContribution.verbs` to be typed `Partial<WebHandsPage>` and the doc comments to say "webhands' 8 seam verbs," so I never misread it as Playwright's `Page` and never think I must implement a large surface.
6. As a webhands maintainer, I want the doc comments / `{@link Page}` references that point at the SEAM type updated to `WebHandsPage` (and the ones that legitimately mean Playwright's page left pointing at Playwright), so the JSDoc cross-references stay correct after the split.
7. As a webhands maintainer, I want the rename to change ZERO behaviour: the 8 verbs, the `WaitCondition`/`Snapshot`/`Cookie`/locator-string contracts, the session RPC wire shape (`SessionRpcBuiltInRequest` / `{verb:'hand', name, args}`), the hand contract semantics, and the trust model are all byte-for-byte unchanged — only the type's NAME differs.
8. As a webhands maintainer, I want the existing test suite (including `hand-host.test.ts`, `hand-loading.test.ts`, `agent-exposed-hand-verb-over-rpc.test.ts`, and the transport/session tests) to pass UNCHANGED except for the renamed type references, so the rename is proven behaviour-preserving by the existing proofs.
9. As a webhands maintainer, I want a `pnpm changeset` recording the BREAKING rename (the exported `Page` type becomes `WebHandsPage`), so the package versions correctly per the repo convention.
10. As a webhands maintainer, I want an ADR (or a focused amendment to ADR-0007/ADR-0003) recording WHY the seam type was renamed (the Playwright-`Page` collision + the misread it caused) and that it is a name-only change, so the decision is durable and the next reader does not re-litigate it.

## Out of Scope

- **Any `HandContribution` REDESIGN.** Separating third-party hand verbs into their own namespace (`{ page, hands }`), changing the `Partial<...>` shape, adding a `defineHand` helper, or a hand-override policy are all explicitly NOT done here. The conversation that spawned this PRD considered that redesign and REJECTED it as YAGNI: `Partial<Page>` is correct for built-in hands, and the third-party-verb runtime-cast path is already tested and working (`rpc-hand.mjs`). The ONLY defect being fixed is the type's NAME. If a real second hand later motivates a namespacing redesign, that is a fresh PRD.
- **No verb additions/removals, no wire-protocol change, no trust-model change.**
- **iamhuman's hand adapter** is built in the iamhuman repo (PRD `imperva-page-read-sitekey-and-webhands-hand`), not here. This PRD only makes the type name its adapter's types will reference honest; it does not change a line of iamhuman code.

## Further Notes

- Provenance: this PRD was spawned from the iamhuman-hand grilling session (2026-06-27). The collision was discovered when `HandContribution.verbs: Partial<Page>` was misread as Playwright's `Page`. The iamhuman cross-repo note `work/notes/observations/webhands-hand-contract-is-landed-and-cites-stale-imperva-finding.md` (in the iamhuman repo) records the read of this repo's landed hand contract.
- Unrelated but noticed while grounding: the LANDED task `work/tasks/ready/iamhuman-captcha-hand-first-thirdparty.md` cites the STALE (pre-Update) iamhuman Imperva finding as rationale ("sitekey out-of-band on Imperva"). Its SCOPE (standard-direct-embed proof) is unaffected, but its stated reason is now corrected by the iamhuman finding's `## Update 2026-06-27` (the sitekey IS page-readable on Imperva via the same-origin `#main-iframe`). This is a separate, pre-existing item — NOT part of this rename PRD — flagged here only so a human can route a rationale fix to that task when it is next touched.
