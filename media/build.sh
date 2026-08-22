#!/usr/bin/env bash
# Rasterise the brand sources. Sources are the .svg files in this directory;
# preview.png and icon.png are generated and should never be hand-edited.
#
# Needs Inkscape (rasteriser) and ImageMagick (downsampler) on PATH.
set -euo pipefail

cd "$(dirname "$0")"

# --- drift check -------------------------------------------------------------
# The mark appears in three files: logo.svg, icon.svg and preview.svg. That
# duplication is deliberate (each needs a different frame, and an <use href> to a
# fourth file would break the moment one of these is opened on its own) but it
# can silently rot, so compare the geometry between the MARK-BEGIN / MARK-END
# markers and fail loudly rather than shipping three marks that no longer match.
geom() { sed -n '/MARK-BEGIN/,/MARK-END/p' "$1" | grep -oE '<(rect|circle|ellipse|g)[^>]*>' | tr -s '[:space:]' ' '; }
for f in icon.svg preview.svg; do
	if [ "$(geom logo.svg)" != "$(geom "$f")" ]; then
		echo "error: mark geometry in $f has drifted from logo.svg" >&2
		diff <(geom logo.svg) <(geom "$f") >&2 || true
		exit 1
	fi
done

# --- render ------------------------------------------------------------------
# Rendered at 2x and downsampled: the mark is built from hard-edged capsules and
# a circle, and rasterising straight to the target size visibly stairsteps them.
inkscape preview.svg -o /tmp/webhands-preview@2x.png -w 2560 >/dev/null 2>&1
magick /tmp/webhands-preview@2x.png -resize 1280x640 -strip preview.png

inkscape icon.svg -o /tmp/webhands-icon@2x.png -w 1024 >/dev/null 2>&1
magick /tmp/webhands-icon@2x.png -resize 512x512 -strip icon.png

echo "wrote media/preview.png (1280x640) and media/icon.png (512x512)"
