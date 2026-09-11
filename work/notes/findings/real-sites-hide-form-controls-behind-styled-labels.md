---
title: 'Real sites hide radios/checkboxes behind styled labels, and a dispatched click still toggles them'
slug: real-sites-hide-form-controls-behind-styled-labels
type: finding
status: verified
created: 2026-09-11
source: 'Observed on eki-net.com (seat selection radios) during a live authenticated session, Sept 2026. Browser behaviour measured locally against Chromium 1228: both hiding techniques refuse a real click and both still toggle on a dispatched one; fixture + assertions in `packages/core/test/dom-escape-and-click-via.test.ts`.'
---

## What is true about real pages

Production sites routinely make a form control invisible and put a styled `<label>`
on top, because that is how you style a radio or checkbox. Two techniques, both
common, and they differ in ways that matter:

- `opacity: 0` plus zero width/height (often absolutely positioned). The element is
  still in the layout.
- `display: none`. The element is out of the layout entirely.

Measured against Chromium 1228, a Playwright actionability-checked click NEVER
succeeds on either: the element cannot become visible, so the click waits out its
timeout. That is correct behaviour, not a Playwright bug: a human could not click
that element, they click the label.

## What is true about dispatched clicks

A dispatched `click` event DOES toggle such a control, and fires `change`. Verified
for both hiding techniques: `el.checked` flips and the page's `change` handler runs.
This is the HTML activation behaviour, which runs for untrusted click events too, and
it is why a dispatched click is a faithful substitute for a click specifically (and
why the same trick does NOT substitute for typing, hovering or dragging, whose
synthetic forms omit real input state).

Also measured: Playwright's per-action timeouts differ wildly in consequence on such
a control. `fill`, `selectOption` and `hover` each burn the full 30s default and then
fail, because nothing shortens the wait for them.

## Why it matters

An agent driving a real booking or checkout flow WILL meet these controls, and the
naive reading of the failure ("the locator is wrong") is wrong. The right reading is
"this control is functional but unreachable, so fire the event at it deliberately".

The counter-risk is equally real and must travel with the fact: an invisible control
a human cannot reach is SOMETIMES a honeypot, because anti-bot forms use exactly that
pattern. So firing events at invisible elements must stay a deliberate act, never a
default (see `docs/adr/0015`).
