"""
Render the icon at the sizes iOS actually uses, to check the thin fold seam
survives downscaling.

A mark can look right at 1024 and fall apart at 60pt. The seam is the detail at
risk: it is ~11px wide on the 1024 master, so at 180px it is under 2px and at
120px it is ~1px. If it disappears, the two panels merge into one flat blob and
the plane reads as a generic arrow.

Writes a strip showing the icon at home-screen sizes so this can be judged the
way a user would see it.
"""

from PIL import Image

SRC = (
    "/Users/tylermorgan/Desktop/trip-packer/ios/App/App/"
    "Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png"
)
OUT = "/tmp/appicon-sizes.png"

# pt -> px at 3x, the sizes that matter on an iPhone home screen
SIZES = [180, 120, 1024]  # 60pt @3x, 40pt @3x (Spotlight/settings), master

img = Image.open(SRC).convert("RGB")

pad = 24
tiles = []
for s in SIZES:
    tiles.append(img.resize((s, s), Image.LANCZOS))

strip_w = sum(t.width for t in tiles) + pad * (len(tiles) + 1)
strip_h = max(t.height for t in tiles) + pad * 2
strip = Image.new("RGB", (strip_w, strip_h), (28, 28, 32))

x = pad
for t in tiles:
    # vertical-centre each tile
    strip.paste(t, (x, pad + (max(tt.height for tt in tiles) - t.height) // 2))
    x += t.width + pad

strip.save(OUT, "PNG")
print("wrote", OUT, "->", strip.size)

# Report the seam width in device pixels, which is what actually determines
# whether it survives. Kept in sync with SEAM_FRACTION in make-app-icon.py.
SEAM_FRACTION = 0.022
master_seam_px = 1024 * SEAM_FRACTION
for s in SIZES:
    print("  at {}px: seam ~= {:.2f}px".format(s, master_seam_px * s / 1024))
