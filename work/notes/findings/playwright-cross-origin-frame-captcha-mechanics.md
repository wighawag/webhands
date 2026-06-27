---
title: Playwright CAN traverse nested cross-origin frames (frameLocator + coordinate, both spike-verified on synthetic) — but end-to-end on a REAL Imperva page is still unverified
slug: playwright-cross-origin-frame-captcha-mechanics
type: finding
status: incubating
source: 'two live Playwright spikes captured 2026-06-27 (real headless Chromium, doubly-nested cross-origin iframes over 3 local origins): (a) absolute-coordinate mouse + page screenshot, (b) frameLocator(WAF).frameLocator(hcaptcha) DOM read + locator click. PLUS per-frame DOM probes + a compressed DOM snapshot of a REAL Imperva page (https://imperva.tender-lab.dev, captured 2026-06-27) run in all three frames (top / #main-iframe / hCaptcha challenge frame). PLUS iamhuman ground truth @ ~/dev/github/wighawag/iamhuman: work/notes/findings/imperva-nests-hcaptcha-in-cross-origin-iframes.md (2026-06-26), packages/playwright-driver/src/driver.ts, backend/src/iamhuman/{commercial,twocaptcha}.py'
---

> CORRECTION NOTE: an earlier version of this finding wrongly concluded "iamhuman
> never uses nested frames; the sitekey is a top-document read; Q6 is resolved".
> That was over-concluded from reading only the flat-coordinate `PlaywrightDriver`
> and the 2Captcha solver, and it MISSED iamhuman's own Imperva finding. The
> extension's frame-blindness is a SAME-ORIGIN-POLICY limitation of the
> content-script transport, NOT evidence frames are irrelevant. On Imperva, frames
> are central. This version corrects it.

## What this addresses

The "hands" prd's deferred **Q6 spike** (the `needsAnswers` that was on the
`iamhuman-captcha-hand-first-thirdparty` task): *does Playwright reach + operate
nested cross-origin frames (a WAF iframe containing a captcha iframe) via
`frameLocator(...).frameLocator(...)` + coordinate clicks + screenshot?*

It is the SAME open question iamhuman's repo records as still-unverified (see
`imperva-nests-hcaptcha-in-cross-origin-iframes.md` → "Still unverified (open)").

## Imperva ground truth (from iamhuman's live investigation, not assumed)

On a real Imperva (Incapsula) page, hCaptcha renders TWO cross-origin iframes
deep:

```
top (host page)
└─ iframe#main-iframe        ← cross-origin (Incapsula/Imperva _Incapsula_Resource)
   └─ iframe newassets.hcaptcha.com/.../hcaptcha.html ← cross-origin AGAIN
      └─ .task tiles + the h-captcha-response token sink
```

Critical consequences (iamhuman verified these live):

- The **clickable tiles AND the token sink are two cross-origin boundaries below
  the host page** — so a host-document coordinate click does not reach them, and
  a host-document DOM query does not find the token sink.
- The **sitekey is NOT scrapeable** from the host document OR the challenge frame
  (it is runtime-initialized via postMessage into the frame; the real value lives
  in the cross-origin Incapsula parent's widget config). So **even 2Captcha /
  Stage-A token-harvest needs the sitekey OUT-OF-BAND** on Imperva (an operator
  reads it once from the Network tab; iamhuman's `stage-a-live.ts` uses
  `IAMHUMAN_DEMO_SITEKEY`). My earlier "sitekey = top-document read" was WRONG for
  Imperva.
- Therefore Extension and Playwright drivers are **NOT equivalent on Imperva**:
  the content-script extension is structurally blocked by SOP (cannot reach
  sitekey / token sink / tiles); the **Playwright/CDP driver is the only path**,
  because it can enumerate and operate nested cross-origin frames.

## Spike result — the Playwright MECHANISM works on synthetic nested frames

Two live spikes (real headless Chromium via `@webhands/core`'s `playwright` dep)
against a doubly-nested cross-origin frame tree (three local origins, ports
9300-9302 / 9310-9312):

Spike A — coordinate + screenshot:
```
coordinate_click_reached_nested_cross_origin_frame: true   (page.mouse.click(x,y) absolute)
screenshot_captured_nonempty: true                         (page.screenshot through frames)
frames_enumerable: true   (frame_count: 3 — top + WAF + captcha)
```
Spike B — frameLocator DOM traversal:
```
frameLocator_click_ok: true        (page.frameLocator('#waf').frameLocator('iframe').locator('#tile').click())
frameLocator_read_token: "TOKEN123" (…locator('[name=h-captcha-response]').inputValue() — read through TWO cross-origin frames)
```

So **both** mechanisms iamhuman's Imperva path could use are available in
Playwright: absolute-coordinate mouse + page screenshot AND
`frameLocator`-chained DOM read/click two cross-origin boundaries deep. (This
corrects the earlier claim that `frameLocator` traversal was unused/irrelevant —
it is exactly what iamhuman's Imperva path leans on to reach the token sink.)

## REAL Imperva page evidence (2026-06-27 per-frame probes) — corrects iamhuman's finding

Per-frame probes + a DOM snapshot of a real Imperva page
(`https://imperva.tender-lab.dev`) settle the STRUCTURAL/addressing half on a
real page (not just synthetic). Frame tree and origins:

```
top                origin=imperva.tender-lab.dev   isTop=true
 └─ iframe#main-iframe   origin=imperva.tender-lab.dev   parentOrigin=imperva.tender-lab.dev
    │                    ^^ SAME ORIGIN as top (top probe: sameOriginReachable=TRUE,
    │                       childTokenSinkVisible=TRUE) — top CAN read into it
    │   sitekey: data-sitekey="e94865c2-4231-4c25-9c6e-2b797b2b56cf" (FOUND here)
    │   token sink: h-captcha-response + g-recaptcha-response <textarea> (FOUND here)
    ├─ hCaptcha checkbox frame   origin=newassets.hcaptcha.com  (cross-origin, walled)
    └─ hCaptcha challenge frame  origin=newassets.hcaptcha.com  parentOrigin=CROSS-ORIGIN
         tiles=28, challenge_container=true   (the tile grid lives here)
```

**This CORRECTS iamhuman's `imperva-nests-hcaptcha-in-cross-origin-iframes.md`,
which concluded the sitekey is UNREACHABLE / out-of-band.** That conclusion was a
probe-DEPTH artifact: iamhuman ran `[data-sitekey]` in the TOP frame (correctly
empty there) and did not descend into `#main-iframe`. But `#main-iframe` is
**same-origin** with the top page (both `imperva.tender-lab.dev`), so a
top-document script CAN read into it. On this page:

- **The sitekey IS scrapeable** — present as `div.h-captcha[data-sitekey]` and in
  both hCaptcha iframe `src` hashes, all inside the same-origin `#main-iframe`,
  reachable from the top via one same-origin hop (`contentDocument` /
  `frameLocator`). No out-of-band value needed on this page.
- **The token sink is reachable** (`h-captcha-response` / `g-recaptcha-response`
  `<textarea>` in `#main-iframe`, same-origin) — read/writeable, so token
  INJECTION has a real target.
- **Only the TILES are cross-origin-walled** (the hCaptcha challenge frame, 2
  deep) — addressable solely via Playwright `frameLocator` or coordinate click,
  which is exactly the spike-verified mechanism. Vision-solving needs this;
  commercial-API token-harvest does NOT.
- **Submit is NOT a form.** There is no `<form>` (the keydown handler references a
  non-existent `id="captcha-form"`). Imperva's `onCaptchaFinished(token)` callback
  (wired via `div.h-captcha[data-callback]`) does an XHR POST
  `g-recaptcha-response=<token>` to `/_Incapsula_Resource?SWCGHOEL=v2&dai=<half of
  incident_id>`. So the solve flow is inject-token-then-fire-callback (or replay
  that POST in-session), not a form submit. The `dai`/`incident_id` binding ties a
  token to a specific Incapsula incident/session.

**Consequence — the SIMPLEST viable path needs NO nested-frame tile clicking:**
read sitekey (`#main-iframe`, same-origin) + URL -> 2Captcha
`HCaptchaTaskProxyless` -> inject token into the sink -> fire `onCaptchaFinished`.
Vision-solving (clicking the 28 cross-origin tiles) is the harder fallback that
actually needs `frameLocator`/coordinate ops.

## What is STILL UNVERIFIED (the honest residue — a static snapshot CANNOT close this)

The DOM snapshot + per-frame probes settle the STRUCTURE (Q6a). They are captured
in a NORMAL browser, so they cannot settle the DYNAMIC/ADVERSARIAL half (Q6b):

- **Anti-bot detection — the big one.** The capture is what a normal browser was
  served. A CDP-driven Chromium (Playwright) may be detected and served a
  DIFFERENT DOM, a hard block, or a higher-friction challenge. Nothing static can
  reveal this; only a live CDP run can.
- **Does inject-token + fire-callback actually satisfy Imperva?** The token must
  be posted in the right session context (the `dai`/`incident_id` binding shows
  Imperva ties the solve to a specific incident); server-side re-validation /
  behavioral scoring may reject an externally-injected token. Runtime-only.
- **Token-injection acceptance + timing** on the live widget is not exercised by
  a snapshot.

This residue (Q6b) is what only a throwaway live run against a provisioned
Imperva page can close. The operator has indicated a full end-to-end run is not
available to this analysis, so Q6b stays OPEN and iamhuman-owned; the snapshot
has done everything a static capture can (it closed Q6a and corrected the
sitekey-reachability claim).

## Consequence for the task

- **Q6a (structure/addressing) is RESOLVED on a real Imperva page; Q6b
  (live anti-bot solve) stays OPEN.** Resolved: the Playwright frame mechanism
  exists (coordinate AND `frameLocator`), the real frame tree + origins are known,
  the sitekey IS scrapeable (same-origin `#main-iframe`), and the token sink is
  reachable — so the approach is not foreclosed and webhands' `pwPage` exposes
  everything needed. STILL OPEN (Q6b): whether a CDP-driven browser is served the
  same DOM and whether inject-token+callback satisfies live Imperva — needs a
  live run iamhuman owns.
- **Webhands-side: no blocker.** The hands abstraction and the `pwPage` it hands a
  hand are sufficient regardless; the residual risk is entirely in iamhuman's
  Imperva approach, not in webhands. So the task can proceed to WIRE iamhuman as
  a hand (loading + Model-B surface) and prove it against a STANDARD direct
  hCaptcha embed (which needs no out-of-band sitekey and no nested frames); the
  REAL-Imperva end-to-end proof remains an iamhuman-owned live spike, tracked
  separately.

## Note for whoever builds the task

- On THIS Imperva page the sitekey IS scrapeable (from the same-origin
  `#main-iframe`), correcting the earlier "out-of-band" assumption. Do not
  hard-assume EITHER way: read it from `#main-iframe` if present; fall back to an
  operator-supplied value (`IAMHUMAN_DEMO_SITEKEY`-style) only if a future Imperva
  variant truly hides it.
- The simplest first webhands proof remains a STANDARD direct hCaptcha page
  (exercises the load + Model-B wiring with zero Imperva-specific risk). Imperva
  end-to-end is the iamhuman-owned follow-up gated on Q6b (the live anti-bot run).
- iamhuman's real driver can use BOTH the flat-coordinate path (`page.mouse`,
  `page.screenshot`) and `frameLocator`-chained traversal. For the commercial-API
  path it needs NEITHER tile clicking NOR nested-frame reads beyond the
  same-origin `#main-iframe` token sink. All available on the live `pwPage`.
