"""
Regenerate the PWA / apple-touch icons from the app-icon master.

There are eight of these across two directories (public/icons for Next, and
ios/App/App/public/icons for what Capacitor copies into the shell). They are the
icon users see when they add the web app to a home screen, so they have to match
the native icon or the two disagree.

Two variants matter:
  * icon-maskable-512 -- Android masks maskable icons and may crop to a circle
    or squircle, keeping only the centre 80%. The glyph must sit inside that safe
    zone, so it is rendered SMALLER here than in the regular icon. Reusing the
    regular artwork for the maskable slot is the classic mistake: the wings get
    clipped on Android home screens.
  * apple-touch-icon -- iOS applies its own rounding, so keep it square and
    opaque.
"""

import os
import sys

from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

MASTER = (
    "/Users/tylermorgan/Desktop/trip-packer/ios/App/App/"
    "Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png"
)

TARGETS = [
    # (path, size, is_maskable)
    ("public/icons/apple-touch-icon.png", 180, False),
    ("public/icons/icon-192.png", 192, False),
    ("public/icons/icon-512.png", 512, False),
    ("public/icons/icon-maskable-512.png", 512, True),
    ("ios/App/App/public/icons/apple-touch-icon.png", 180, False),
    ("ios/App/App/public/icons/icon-192.png", 192, False),
    ("ios/App/App/public/icons/icon-512.png", 512, False),
    ("ios/App/App/public/icons/icon-maskable-512.png", 512, True),
]

ROOT = "/Users/tylermorgan/Desktop/trip-packer"

# Android's maskable safe zone: the inner 80% circle. Scale the master down so
# the whole glyph lands inside it, i.e. leave 10% padding on every side.
MASKABLE_INSET = 0.10


def build_variant(size, maskable):
    master = Image.open(MASTER).convert("RGB")
    if not maskable:
        return master.resize((size, size), Image.LANCZOS)

    # Build the padded tile by shrinking the master to the inner safe zone and
    # placing it on a background derived from the master itself. Scaling the
    # whole master up to fill the tile and then pasting the glyph over it gives
    # a seamless edge (the padding is the master's own colours, so no visible
    # ring, which a hard black pad would produce on Android).
    pad = round(size * MASKABLE_INSET)
    inner = size - 2 * pad

    # Edge extension: upscale the master so it fills the tile, then blur-free
    # paste the crisply-scaled inner artwork on top.
    backdrop = master.resize((size, size), Image.LANCZOS)
    glyph = master.resize((inner, inner), Image.LANCZOS)
    backdrop.paste(glyph, (pad, pad))
    return backdrop


def main():
    for rel, size, maskable in TARGETS:
        path = os.path.join(ROOT, rel)
        img = build_variant(size, maskable)
        img.save(path, "PNG")
        kind = "maskable" if maskable else "standard"
        print("  {:<52} {:>4}x{:<4} {:<9} {} bytes".format(
            rel, size, size, kind, os.path.getsize(path)))


if __name__ == "__main__":
    main()
