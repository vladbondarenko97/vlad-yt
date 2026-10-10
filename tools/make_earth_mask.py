"""Rasterise Natural Earth land polygons into the equirectangular mask the Earth shader reads.

R channel: anti-aliased land mask.  G channel: wide blur of the mask (continental shelf falloff).
Run from the repo root:  npm run earth-mask
"""
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent
W, H = 4096, 2048
SS = 2  # supersample for clean coastlines

geo = json.loads((ROOT / "land.geojson").read_text())
feats = geo["features"] if geo["type"] == "FeatureCollection" else [geo]

img = Image.new("L", (W * SS, H * SS), 0)
draw = ImageDraw.Draw(img)


def unwrap(ring):
    """Remove the +/-360 jumps of rings that cross the antimeridian."""
    out, shift, prev = [], 0.0, None
    for lon, lat in (p[:2] for p in ring):
        if prev is not None:
            if lon + shift - prev > 180:
                shift -= 360
            elif lon + shift - prev < -180:
                shift += 360
        prev = lon + shift
        out.append((prev, lat))
    return out


def xy(lon, lat):
    return ((lon + 180.0) / 360.0 * W * SS, (90.0 - lat) / 180.0 * H * SS)


def polygon(rings):
    # Draw each ring three times (-360, 0, +360) so wrapped rings land on both edges.
    for k in (-360, 0, 360):
        draw.polygon([xy(lon + k, lat) for lon, lat in unwrap(rings[0])], fill=255)
    for hole in rings[1:]:
        for k in (-360, 0, 360):
            draw.polygon([xy(lon + k, lat) for lon, lat in unwrap(hole)], fill=0)


for f in feats:
    g = f["geometry"]
    if g["type"] == "Polygon":
        polygon(g["coordinates"])
    elif g["type"] == "MultiPolygon":
        for rings in g["coordinates"]:
            polygon(rings)

land = img.resize((W, H), Image.LANCZOS)
shelf = land.filter(ImageFilter.GaussianBlur(14))
out = Image.merge("RGB", (land, shelf, Image.new("L", (W, H), 0)))
dest = ROOT.parent / "assets" / "img" / "earth-land.webp"
out.save(dest, quality=84, method=6)
print("wrote", dest, dest.stat().st_size // 1024, "KB")

# The same image as a data URL inside a script. The page loads it only when it is opened
# from disk (file://), where browsers will not hand an image file to WebGL.
import base64

local = ROOT.parent / "assets" / "js" / "earth-land.data.js"
local.write_text(
    'window.__EARTH_LAND__="data:image/webp;base64,' + base64.b64encode(dest.read_bytes()).decode() + '";\n'
)
print("wrote", local, local.stat().st_size // 1024, "KB")
