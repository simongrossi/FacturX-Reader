"""Build the website image assets from the repository screenshots.

Usage: python site/tools/build-images.py
Reads docs/screenshots/*.png and writes site/assets/img/*.webp, *.jpg and og-image.jpg.
"""

from __future__ import annotations

import pathlib

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = pathlib.Path(__file__).resolve().parents[2]
SRC = ROOT / "docs" / "screenshots"
OUT = ROOT / "site" / "assets" / "img"
FONTS = pathlib.Path("C:/Windows/Fonts")

SHOTS = [
    ("controles", 1800),
    ("pdf-et-donnees", 1800),
    ("tableau", 1800),
]

ACCENT = (11, 107, 203)
AMBER = (245, 158, 11)


def font(name: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(FONTS / name), size)


def rounded(image: Image.Image, radius: int) -> Image.Image:
    mask = Image.new("L", image.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (0, 0, image.width - 1, image.height - 1), radius=radius, fill=255
    )
    out = image.convert("RGBA")
    out.putalpha(mask)
    return out


def build_screenshots() -> None:
    for name, width in SHOTS:
        src = Image.open(SRC / f"{name}.png").convert("RGB")
        ratio = width / src.width
        shot = src.resize((width, round(src.height * ratio)), Image.LANCZOS)
        shot.save(OUT / f"{name}.webp", "WEBP", quality=84, method=6)
        shot.save(OUT / f"{name}.jpg", "JPEG", quality=88, optimize=True, progressive=True)
        # Small variant for phones: keeps the first paint light.
        small = src.resize((900, round(src.height * 900 / src.width)), Image.LANCZOS)
        small.save(OUT / f"{name}-900.webp", "WEBP", quality=80, method=6)
        print(f"{name}: {shot.size} -> {small.size}")


def build_og() -> None:
    W, H = 1200, 630
    base = Image.new("RGBA", (W, H), (8, 19, 31, 255))
    draw = ImageDraw.Draw(base)

    # Vertical gradient, deep navy to brand blue.
    for y in range(H):
        t = y / H
        r = round(8 + (11 - 8) * t)
        g = round(19 + (58 - 19) * t)
        b = round(31 + (120 - 31) * t)
        draw.line([(0, y), (W, y)], fill=(r, g, b, 255))

    # Soft glow behind the screenshot.
    glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(glow).ellipse((580, -140, 1500, 640), fill=(56, 160, 248, 60))
    glow = glow.filter(ImageFilter.GaussianBlur(90))
    base = Image.alpha_composite(base, glow)

    # Screenshot card on the right.
    shot = Image.open(SRC / "controles.png").convert("RGB")
    target_w = 540
    shot = shot.resize((target_w, round(shot.height * target_w / shot.width)), Image.LANCZOS)
    shot = rounded(shot, 20)
    shadow = Image.new("RGBA", (shot.width + 120, shot.height + 120), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle(
        (60, 60, shot.width + 60, shot.height + 60), radius=26, fill=(2, 10, 20, 170)
    )
    shadow = shadow.filter(ImageFilter.GaussianBlur(26))
    pos = (1200 - target_w - 40, 132)
    base.alpha_composite(shadow, (pos[0] - 60, pos[1] - 60 + 6))
    base.alpha_composite(shot, pos)

    draw = ImageDraw.Draw(base)

    # Logo mark.
    draw.rounded_rectangle((80, 62, 140, 122), radius=16, fill=ACCENT)
    draw.rounded_rectangle((96, 75, 124, 109), radius=3, fill=(255, 255, 255))
    draw.polygon([(113, 75), (124, 86), (113, 86)], fill=(185, 214, 245))
    draw.ellipse((116, 100, 136, 120), fill=AMBER)
    draw.line([(121, 105), (131, 115)], fill=(255, 255, 255), width=2)
    draw.line([(131, 105), (121, 115)], fill=(255, 255, 255), width=2)

    draw.text((156, 70), "Factur-X Reader", font=font("segoeuib.ttf", 34), fill=(255, 255, 255))
    draw.text((156, 110), "facturxreader.com", font=font("segoeui.ttf", 19), fill=(150, 186, 224))

    # Punchline, kept well clear of the screenshot (max x = 580).
    headline = font("segoeuib.ttf", 47)
    for i, line in enumerate(["Vos factures, lues", "et vérifiées", "sur votre poste."]):
        draw.text((80, 210 + i * 58), line, font=headline, fill=(255, 255, 255))

    draw.text((80, 400), "Factur-X, UBL et CII", font=font("segoeui.ttf", 21), fill=(163, 197, 232))
    draw.text((80, 430), "100 % hors ligne · Windows, macOS, Linux", font=font("segoeui.ttf", 21), fill=(163, 197, 232))

    # Badge on its own layer: ImageDraw replaces pixels instead of blending alpha.
    overlay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    odraw = ImageDraw.Draw(overlay)
    badge_font = font("segoeui.ttf", 20)
    badge_text = "Gratuit · Licence PolyForm Shield"
    text_w = odraw.textlength(badge_text, font=badge_font)
    odraw.rounded_rectangle((80, 496, 80 + 56 + text_w + 24, 548), radius=26, fill=(255, 255, 255, 30))
    odraw.ellipse((99, 513, 115, 529), fill=(52, 211, 153))
    odraw.text((128, 509), badge_text, font=badge_font, fill=(226, 238, 250))
    base = Image.alpha_composite(base, overlay)

    base.convert("RGB").save(OUT / "og-image.jpg", "JPEG", quality=90, optimize=True, progressive=True)
    print("og-image.jpg 1200x630")


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    build_screenshots()
    build_og()

    # favicon.ico : dérivé de l'icône Apple Touch si elle a déjà été rendue.
    icon = OUT / "apple-touch-icon.png"
    if icon.exists():
        Image.open(icon).convert("RGBA").save(
            ROOT / "site" / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)]
        )
        print("favicon.ico")
    else:
        print("apple-touch-icon.png absent : lancer site/tools/preview.js d'abord")
