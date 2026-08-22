# media

Brand sources for webhands. `logo.svg`, `icon.svg` and `preview.svg` are **authored**; `preview.png` and `icon.png` are **generated** by `build.sh` and should never be hand-edited.

| Source        | Published as  | How                             |
| ------------- | ------------- | ------------------------------- |
| `preview.svg` | `preview.png` | `./media/build.sh` (1280x640)   |
| `icon.svg`    | `icon.png`    | `./media/build.sh` (512x512)    |
| `logo.svg`    | itself        | used directly wherever SVG fits |

## Regenerating

```sh
./media/build.sh
```

Needs Inkscape (rasteriser) and ImageMagick (downsampler). It does not need any font installed: the wordmark and the tagline in `preview.svg` are outlines, not text. Everything is rendered at 2x and downsampled, because the mark is built from hard-edged capsules and rasterising straight to the target size stairsteps them.

## Social meta tags

`preview.png` is 1280x640, the 2:1 ratio Open Graph and Twitter/X both accept without cropping, and it is also what GitHub wants for a repository social preview (Settings, Social preview, upload `media/preview.png`).

Until a site exists, the canonical URL is the raw file:

```html
<meta property="og:title" content="webhands" />
<meta property="og:description" content="Let your AI agent drive a real, logged-in browser." />
<meta property="og:image" content="https://raw.githubusercontent.com/wighawag/webhands/main/media/preview.png" />
<meta property="og:image:width" content="1280" />
<meta property="og:image:height" content="640" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:image" content="https://raw.githubusercontent.com/wighawag/webhands/main/media/preview.png" />
```

## The mark

A segmented machine hand holding the open web in its palm. The hand is the product name and the promise (an agent gets hands); the planet is what those hands are on. Fusing them into one object is the point: an earlier draft put a hand *on top of* a browser window, which is two metaphors stacked rather than one idea, and it read as a sticker of a hand on a sticker of a window.

Things that are easy to "fix" by mistake:

- **The joint gaps are the whole bionic reading.** Each finger is two capsules with a 10px gap; a real hand has no seams. Close the gaps to make it "cleaner" and you get a mitten.
- **The gaps are holes, not dark fills.** Nothing in the mark is painted with the background colour, so it drops onto light, dark or a photo unchanged.
- **Green is reserved for exactly one thing: the web.** Every mechanical part is ink. Accent pins across the knuckles were tried and dropped, because then green meant "joints" and "the web" at once and neither reading survived.
- **The graticule is drawn on the disc, not knocked out of it,** and clipped to it. Drawn as knockouts it would need a mask; clipped, no bar corner can poke past the horizon and the planet needs no special handling.
- **Ink is `currentColor`** in `logo.svg`, so one file serves light and dark; only the green is fixed.

## icon.svg is not logo.svg

One deliberate difference: the icon carries **its own dark plate with light ink** (`#12141a`, `rx="48"`), because a transparent icon with dark ink vanishes on a dark browser tab.

Unlike a scene-style logo there is nothing else to strip: the mark is already a single object. Everything between the `MARK-BEGIN` / `MARK-END` markers is byte-identical in all three files, and `build.sh` compares it and fails before rendering if it ever drifts.

## preview.svg is full bleed and square-cornered

Deliberate. The rounded plate belongs to the icon. A rounded card just draws a smaller card inside the one the feed already drew, and every platform crops or letterboxes it differently, so the corners are the first thing to go wrong.

## Type

The wordmark is **URW Gothic Demi**, an Avant Garde clone, matching the house face used across these tools; its circular bowls sit naturally beside a mark built entirely from capsules and a disc. The tagline is **JetBrains Mono**, because this is a CLI first. Neither font is vendored, because neither is needed at build time.

URW Gothic is AGPL-3 with a font exception, and this repo is AGPL-3.0, so the outlines can live in `preview.svg`.

Both sizes were solved to a target width rather than picked, so they can be re-derived. To regenerate after a copy change, set the text with `font-family:'URW Gothic';font-weight:bold` (the plain family name resolves to Book, which is too light) at `128px` for the wordmark, and `font-family:'JetBrains Mono'` at `30.086px` with `letter-spacing:1.5px` for the tagline, positioned at `x=458,y=320` and `x=457,y=414`, then:

```sh
inkscape text.svg --export-text-to-path --export-plain-svg -o outlined.svg
```

and paste the two path `d` attributes back into `preview.svg`. The green rule under the wordmark (`x=459`) is aligned to the wordmark's visual left edge, not to its `x`, so it moves if the size does.

## Directions that were tried and dropped

- **A hand resting on a browser window.** The first draft, and the one that motivated all the others: two metaphors glued together, plus a gradient the rest of the house style does not use.
- **A hand knocked out of a block of page lines.** The most original idea of the set, and the mark I trusted least. Slicing the silhouette to make the lines read cost the hand its legibility, the thumb was swallowed by the accent line, and at 32px it was a striped blob.
- **A jointed hand pressing one live line of a page.** Told the product story best and survived small better than the sliced hand, but a hand with one finger out drifts toward the OS pointer cursor, which is not a thing worth owning.
- **Accent pins across the knuckles.** See above: they split the meaning of the accent colour.
- **A cyan accent.** Cleaner in isolation, but it drifts toward the default blue every other dev tool already uses. Green also reads as live/connected, which is what a session is.

## Known gaps

- **The icon does not resolve at 16px.** The graticule fills in and the fingers merge; what is left is a pale hand shape with a green centre. It degrades rather than breaks, so no purpose-drawn 16px glyph exists. Revisit only if the favicon becomes a real recognition surface.
- **The tagline is decorative at feed-thumbnail size**, which is normal for an Open Graph card: the wordmark carries the recognition.
- **There is no light-background variant of the card.** `preview.png` is dark only. `logo.svg` covers light backgrounds on its own.
