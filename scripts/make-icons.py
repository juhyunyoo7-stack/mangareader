"""Builds the app icons from one square-ish master render (PNG, about 1024 px).

    python scripts/make-icons.py <master.png>

Writes launcher/MangaReader.ico (256/128/64/48/32/16, rounded corners) and the PWA icons
public/icons/icon-192.png, icon-512.png, icon-maskable-512.png. Needs Pillow + numpy.
How the master was made is described in launcher/BUILD.md.
"""
import os
import sys

from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# square crop of the master that holds the book (x0, y0, size), measured on the 1024 px render
CROP = (52, 102, 860)
RADIUS = 0.22  # corner radius as a share of the icon size


def rounded(img: Image.Image) -> Image.Image:
    s = img.size[0]
    big = Image.new("L", (s * 4, s * 4), 0)
    ImageDraw.Draw(big).rounded_rectangle([0, 0, s * 4 - 1, s * 4 - 1], radius=int(s * 4 * RADIUS), fill=255)
    out = img.convert("RGBA")
    out.putalpha(big.resize((s, s), Image.LANCZOS))
    return out


def sized(src: Image.Image, n: int) -> Image.Image:
    im = src.resize((n, n), Image.LANCZOS)
    if n <= 64:  # small sizes: a little crisper so the panel lines survive
        im = im.filter(ImageFilter.UnsharpMask(radius=1, percent=80 if n <= 32 else 50, threshold=2))
    return im


def main() -> None:
    master = Image.open(sys.argv[1]).convert("RGB")
    x0, y0, s = CROP
    art = master.crop((x0, y0, x0 + s, y0 + s))

    ico_sizes = [256, 128, 64, 48, 32, 16]
    frames = [rounded(sized(art, n)) for n in ico_sizes]
    ico = os.path.join(ROOT, "launcher", "MangaReader.ico")
    frames[0].save(ico, format="ICO", sizes=[(n, n) for n in ico_sizes], append_images=frames[1:])

    icons = os.path.join(ROOT, "public", "icons")
    os.makedirs(icons, exist_ok=True)
    # PWA icons: square and opaque (the platform applies its own mask); 256-colour PNG keeps the
    # precached files small and the art survives it well
    for n in (192, 512):
        sized(art, n).quantize(256, dither=Image.Dither.FLOYDSTEINBERG).save(
            os.path.join(icons, f"icon-{n}.png"), optimize=True)
    # maskable: the whole master (more background around the book) shrunk into the 80% safe zone,
    # over a blurred copy of itself so there is no visible seam
    m = master.resize((512, 512), Image.LANCZOS).filter(ImageFilter.GaussianBlur(24))
    inner = 400
    fg = master.resize((inner, inner), Image.LANCZOS)
    feather = Image.new("L", (inner, inner), 0)
    ImageDraw.Draw(feather).rectangle([16, 16, inner - 17, inner - 17], fill=255)
    m.paste(fg, ((512 - inner) // 2, (512 - inner) // 2), feather.filter(ImageFilter.GaussianBlur(10)))
    m.quantize(256, dither=Image.Dither.FLOYDSTEINBERG).save(
        os.path.join(icons, "icon-maskable-512.png"), optimize=True)
    for f in ["launcher/MangaReader.ico", "public/icons/icon-192.png", "public/icons/icon-512.png",
              "public/icons/icon-maskable-512.png"]:
        print(f, os.path.getsize(os.path.join(ROOT, f)), "bytes")


if __name__ == "__main__":
    main()
