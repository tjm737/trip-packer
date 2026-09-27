"""
Measure the generated icon: where is the white glyph actually centred, and how
much of the tile does it fill?

Eyeballing a glyph on a gradient is unreliable -- the eye reads the gradient's
bright corner as weight. This measures the white pixels directly so centring and
scale are numbers, not impressions.
"""

from PIL import Image

DEST = (
    "/Users/tylermorgan/Desktop/trip-packer/ios/App/App/"
    "Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png"
)

img = Image.open(DEST).convert("RGB")
w, h = img.size
px = img.load()

xs, ys = [], []
for y in range(h):
    for x in range(w):
        r, g, b = px[x, y]
        # The glyph is white on emerald; "white" = all channels high and close
        # together. The seam is darker, so exclude it by requiring brightness.
        if r > 200 and g > 200 and b > 200:
            xs.append(x)
            ys.append(y)

if not xs:
    print("no white pixels found -- glyph missing?")
    raise SystemExit(1)

minx, maxx = min(xs), max(xs)
miny, maxy = min(ys), max(ys)
cx = (minx + maxx) / 2
cy = (miny + maxy) / 2

print("canvas           : {}x{}".format(w, h))
print("canvas centre    : ({:.0f}, {:.0f})".format(w / 2, h / 2))
print("glyph bbox       : x {}..{}  y {}..{}".format(minx, maxx, miny, maxy))
print("glyph centre     : ({:.1f}, {:.1f})".format(cx, cy))
print("offset from centre: dx {:+.1f}px  dy {:+.1f}px".format(cx - w / 2, cy - h / 2))
print()
print("glyph width      : {}px  ({:.1f}% of tile)".format(maxx - minx, (maxx - minx) / w * 100))
print("glyph height     : {}px  ({:.1f}% of tile)".format(maxy - miny, (maxy - miny) / h * 100))
print("coverage         : {:.1f}% of tile is glyph".format(len(xs) / (w * h) * 100))
