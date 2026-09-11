# The `--dom` escape stays opt-in, and `click` reports how it clicked

Real sites hide radios and checkboxes behind styled labels, and Playwright correctly refuses to act on a control a human could not reach, so an actionability-checked verb waits out its timeout on a control that plainly works. We give the acting verbs an explicit `--dom` escape that skips the check and fires the event directly, and we deliberately do NOT make it the default, nor extend `click`'s existing short-budget-then-dispatch behaviour to its siblings. Separately, `click` now RETURNS which path it took (`via: 'click' | 'dispatch'`), because its fallback was silent.

## Why opt-in rather than the default

Three reasons, in descending order of how much they should bother you.

1. **An invisible control a human cannot reach is sometimes a honeypot.** Anti-bot forms rely on exactly that: a field only automation would fill. A verb that silently synthesises events at invisible elements is a verb that silently fills traps, and webhands' whole framing is that it acts as the real logged-in user (ADR-0002).
2. **The siblings' synthetic forms are a DIFFERENT action, not the same action minus a check.** A dispatched `click` is the very event the page listens for, which is why `click` can fall back at all. Setting `.value` plus `input`/`change` skips keystroke handling (masked inputs, keydown-driven autocompletes); dispatched mouse events carry no pointer position (CSS `:hover` never fires); synthetic key events insert no text. Each verb documents its own approximation, and `drag` gets no escape at all, because a synthetic drag needs a `DataTransfer` real drop targets routinely ignore and would fail quietly more often than it worked.
3. **Auto-wait is load-bearing.** Playwright's 30s default is the right budget for an element about to become ready (a button enabled by an XHR, a late-hydrated row). Cutting it to ~1s everywhere would fire synthetic events at elements that were about to become genuinely actionable.

So: sibling defaults unchanged (real auto-wait, fail-loud), `--dom` explicit, and `--timeout <ms>` available for the orthogonal complaint, since it changes only how long you wait and never what is performed.

## Why `click` reports `via`

`click` keeps its implicit fallback for backwards compatibility, but it used to be invisible: the caller could not distinguish "I clicked the button" from "I fired a click event at something a user could not have clicked". Those are different claims, and an agent deciding what to do next deserves the difference. Note what `via: 'dispatch'` does and does not mean: it means the element did not become actionable within the budget, which covers a genuinely hidden control AND a merely slow one, so it is a prompt to verify the effect rather than proof of a honeypot.

## Consequences

- `click`'s default actionability budget is ~1s (short, so the fallback is reachable), while the other verbs keep Playwright's 30s. That asymmetry is surprising enough that the `--timeout` help and the skill both state it.
- `WebHandsPage.click` returns `ClickResult` instead of `void`: additive for callers, breaking for anyone IMPLEMENTING the seam outside this repo.
- `press --dom` without a `--locator` is an error rather than a silent no-op, since the focused-element form has no element to fire at and no actionability check to escape.
