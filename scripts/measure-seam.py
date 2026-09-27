"""
Measure the fold seam directly at device sizes.

Eyeballing a 1-3px feature on a downscaled icon is not reliable, and the vision
model's estimates of it contradicted each other. So measure the pixels: walk the
scanline that crosses the seam and count how many columns are NOT white.

If the seam survives, there is a run of background-coloured pixels between the
two white panels. If it has merged, that run is gone and the shape is solid.
"""

from PIL import Image

SRC = (
    "/Users/tylermorgan/Desktop/trip-packer/ios/App/App/"
    "Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png"
)
SIZES = [180, 120, 1024]


def is_white(p):
    r, g, b = p[:3]
    return r > 200 and g > 200 and b > 200


def measure(size):
    img = Image.open(SRC).convert("RGB").resize((size, size), Image.LANCZOS)
    px = img.load()

    # Find the seam: the longest run of non-white pixels that sits BETWEEN two
    # white runs on the same scanline. That is exactly what "a fold line" is.
    best = 0
    best_y = None
    for y in range(size):
        row = [is_white(px[x, y]) for x in range(size)]
        if sum(row) < 4:
            continue
        first_white = row.index(True)
        last_white = size - 1 - row[::-1].index(True)
        # Contiguous non-white stretch inside the glyph's horizontal extent
        run = 0
        for x in range(first_white, last_white + 1):
            if not row[x]:
                run += 1
                if run > best:
                    best = run
                    best_y = y
            else:
                run = 0
    return best, best_y


print("Seam width measured directly, by scanline (in device pixels):")
for s in SIZES:
    w, y = measure(s)
    verdict = "SURVIVES" if w >= 2 else ("marginal" if w == 1 else "GONE")
    print("  {:>4}px  -> seam {:>2}px on scanline y={:<4}  {}".format(s, w, y, verdict))
