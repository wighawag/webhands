---
title: "With --disable-blink-features=AutomationControlled, a CDP-driven Chrome passes Luma's Turnstile, at sign-in AND on an action; without it, the same setup is refused"
slug: turnstile-passes-cdp-with-automation-controlled-disabled
type: finding
status: verified
created: 2026-10-25
source: 'Three runs on telemaque, 25 Oct 2026, minutes apart: Google Chrome 156.0.8078.47 (nixpkgs) on a private Xvfb (-dpi 96), started by `webhands serve --real-chrome` (so a --remote-debugging-port is open and webhands drives it over CDP through Playwright `connectOverCDP`), each on a FRESH signed-out profile in a temp WEBHANDS_HOME, same residential IP. Flow: goto luma.com/signin, type the account email, click "Continue with Email", then click the Turnstile checkbox with `webhands mouse` (CDP `Input.dispatchMouseEvent`; the OS pointer never moved). A fourth run, same day, used the same flag on `luma-ext` (a copy of the human-logged-in `luma` profile): the Request to Join action on luma.com/h6e3ctg6. Screenshots were read from the Xvfb framebuffer; not committed.'
---

## What was measured

| Run     | Extra Chrome arg (via `WEBHANDS_CHROME_ARGS`)   | `navigator.webdriver` (webhands `eval`) | After the Turnstile checkbox click                |
| ------- | ----------------------------------------------- | --------------------------------------- | ------------------------------------------------- |
| A       | `--disable-blink-features=AutomationControlled` | `false`                                 | Passed: Luma moved on to "Enter Code"             |
| Control | none                                            | `true`                                  | Refused: "Verifying..." then back to the checkbox |
| A again | `--disable-blink-features=AutomationControlled` | `false`                                 | Passed: "Enter Code"                              |

| Action | `--disable-blink-features=AutomationControlled`, logged-in profile | `false` | Passed: the event's "Request to Join" raised Turnstile, a CDP click on the checkbox passed it, and the page showed "Pending Approval" |

A separate loopback probe, with no Luma involved, showed the same switch: Chrome 156 with `--remote-debugging-port=0` reads `navigator.webdriver === true`, and adding the flag makes it `false`.

## What it means

- On Luma, Turnstile's deciding signal was the `navigator.webdriver` bit, not CDP's other side effects, both at sign-in and on the action-level re-check that the earlier finding saw refuse CDP. A CDP-driven click, which webhands' Playwright transports already make, passed once the bit was off.
- The flag costs one visible artefact: Chrome shows an infobar, "You are using an unsupported command-line flag ... Stability and security will suffer." A page cannot read that infobar, but it shrinks the viewport by about 56px.
- NOT measured: other Cloudflare configurations, or how long this lasts; a detector change that reads CDP side effects would break it.
- Now a first-class opt-in flag: `serve --real-chrome --hide-webdriver` (ADR-0014 addendum 2), not an env var.
- So the Playwright transports, hands and `script` included, cover Luma's Turnstile with one Chrome flag today. The extension transport (ADR-0018) is the fallback for when a detector starts reading CDP itself, not the only route.
