"""
Verify the maskable icon survives Android's crop.

Android may mask a maskable icon to a circle keeping only the centre 80%. If the
glyph touches the outer 10% it gets clipped. This simulates that crop and checks
the glyph's corners are still inside the circle.
"""

import math

from PIL import Image

ROOT = "/Users/tylermorgan/Desktop/trip-packer"
MASKABLE = ROOT + "/public/icons/icon-maskable-512.png"


def is_white(p):
    r, g, b = p[:3]
    return r > 200 and g > 200 and b > 200


img = Image.open(MASKABLE).convert("RGB")
size = img.size[0]
px = img.load()

cx = cy = size / 2
safe_r = size * 0.40  # inner 80% circle that Android guarantees to keep

# Any white pixel outside the safe circle would be clipped on a circular mask.
outside = 0
for y in range(size):
    for x in range(size):
        if is_white(px[x, y]):
            if math.hypot(x - cx, y - cy) > safe_r:
                outside += 1

total_white = 0
minx, maxx, miny, maxy = size, 0, size, 0
for y in range(size):
    for x in range(size):
        if is_white(px[x, y]):
            total_white += 1
            minx, maxx = min(minx, x), max(maxx, x)
            miny, maxy = min(miny, y), max(maxy, y)

print("maskable icon: {}x{}".format(size, size))
print("  glyph bbox        : x {}..{}  y {}..{}".format(minx, maxx, miny, maxy))
print("  safe circle radius: {:.0f}px".format(safe_r))
print("  glyph pixels outside safe circle: {}".format(outside))
print()
if outside == 0:
    print("  PASS - nothing clipped by a circular Android mask")
else:
    print("  FAIL - {} glyph pixels would be clipped".format(outside))
