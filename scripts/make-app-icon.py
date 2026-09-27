"""
Generate the TripPlanner app icon from the web logo.

The web logo (SidebarContent.tsx) is a 32px box: bg-gradient-to-br from
emerald-400 to emerald-600, containing the airplane emoji. Two things do not
survive the jump to a 1024px app icon:

  * an emoji glyph reads as a flat, toy-like blob at icon scale, and iOS icons
    cannot use emoji anyway -- they need a real mark;
  * emerald-400/600 in Tailwind v4 are oklch, so the hex has to be converted
    rather than eyeballed.

So: same colours (converted exactly), same diagonal gradient direction, and a
hand-drawn vector paper plane echoing the emoji's silhouette -- nose up-right,
notched tail -- crisp at any size.

iOS masks app icons with its own squircle. The gradient is therefore rendered
FLAT to the edges, with no transparency and no baked-in corner radius; drawing
our own rounded corners on top of the system mask is the classic double-corner
mistake and shows as dark fringing in the corners.
"""

import math
import os

from PIL import Image, ImageDraw

SIZE = 1024
SS = 4  # supersample factor; downsampled at the end for clean edges
W = SIZE * SS

# Tailwind v4 oklch -> sRGB, converted exactly:
#   --color-emerald-400: oklch(76.5% 0.177 163.223) -> #00D492
#   --color-emerald-600: oklch(59.6% 0.145 163.225) -> #009966
C_TOPLEFT = (0, 212, 146)
C_BOTRIGHT = (0, 153, 102)

NOSE_RGBA = (255, 255, 255, 255)
SEAM_RGBA = (0, 132, 90, 105)

# Fold-seam width as a fraction of the tile. Width matters more than it looks:
# the seam is NEGATIVE SPACE (a gap showing the background through), so it
# antialiases away first as the icon shrinks. Measured with 0.011 it survived at
# 1024px but was gone by 180px, leaving an ambiguous arrow at 120px -- the size
# that actually appears on a home screen. 0.022 is ~22px on the master and
# ~2.6px at 120px: a deliberate fold rather than a rendering artifact.
SEAM_FRACTION = 0.022

TILT_DEG = -38.0  # nose points up-and-right, like the emoji
SPAN_FRACTION = 0.58

DEST = (
    "/Users/tylermorgan/Desktop/trip-packer/ios/App/App/"
    "Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png"
)


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def make_gradient(size):
    """Diagonal top-left -> bottom-right gradient, matching bg-gradient-to-br."""
    img = Image.new("RGB", (size, size))
    px = img.load()
    denom = 2 * (size - 1)
    for y in range(size):
        for x in range(size):
            # Project onto the diagonal so the two opposite corners land exactly
            # on the endpoint colours.
            px[x, y] = lerp(C_TOPLEFT, C_BOTRIGHT, (x + y) / denom)
    return img


def glyph_points(anchor_x, anchor_y):
    """Corner points of the two panels, positioned at the given anchor."""
    span = W * SPAN_FRACTION
    tilt = math.radians(TILT_DEG)

    def rot(px, py):
        """Rotate a point, given relative to the anchor, by the glyph tilt."""
        return (
            anchor_x + px * math.cos(tilt) - py * math.sin(tilt),
            anchor_y + px * math.sin(tilt) + py * math.cos(tilt),
        )

    # Local frame: +x toward the nose, +y toward the lower wing.
    return {
        "nose": rot(span * 0.50, 0.0),
        "tail_up": rot(-span * 0.42, span * 0.34),
        "tail_in": rot(-span * 0.20, 0.0),
        "tail_dn": rot(-span * 0.40, -span * 0.30),
    }


def draw_glyph(target, pts):
    """Draw the paper plane into any ImageDraw target."""
    # Upper panel
    target.polygon([pts["nose"], pts["tail_up"], pts["tail_in"]], fill=NOSE_RGBA)
    # Lower panel
    target.polygon([pts["nose"], pts["tail_dn"], pts["tail_in"]], fill=NOSE_RGBA)
    # Centre fold. Without it the two panels merge into one flat blob and the
    # glyph reads as a generic arrow.
    target.line(
        [pts["nose"], pts["tail_in"]],
        fill=SEAM_RGBA,
        width=int(W * SEAM_FRACTION),
    )


def ink_centre(pts):
    """Where does the drawn ink actually land? Used to centre the glyph."""
    scratch = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    draw_glyph(ImageDraw.Draw(scratch), pts)
    bbox = scratch.getbbox()
    if not bbox:
        return W / 2, W / 2
    return (bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2


def build():
    grad = make_gradient(W)

    # Centre the glyph on the tile.
    #
    # It is NOT symmetric about its anchor -- the two tail corners reach further
    # than the nose -- so anchoring at the tile centre leaves the visual mass
    # low and left (measured: dx -29.5, dy +54.0 on a 1024 tile, plainly
    # visible to the eye). One correcting nudge is not enough either, because
    # the bbox depends on the seam width, so iterate until it converges.
    anchor_x = anchor_y = W / 2
    for _ in range(8):
        cx, cy = ink_centre(glyph_points(anchor_x, anchor_y))
        err_x, err_y = W / 2 - cx, W / 2 - cy
        anchor_x += err_x
        anchor_y += err_y
        if abs(err_x) < 0.5 and abs(err_y) < 0.5:
            break

    layer = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    draw_glyph(ImageDraw.Draw(layer), glyph_points(anchor_x, anchor_y))

    out = grad.convert("RGBA")
    out.alpha_composite(layer)
    return out.convert("RGB").resize((SIZE, SIZE), Image.LANCZOS)


if __name__ == "__main__":
    img = build()
    img.save(DEST, "PNG")
    print("wrote {} ({} bytes)".format(DEST, os.path.getsize(DEST)))
    print("size: {}  mode: {}".format(img.size, img.mode))
