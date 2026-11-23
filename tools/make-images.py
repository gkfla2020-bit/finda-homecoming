"""Builds the favicon set and the KakaoTalk/Open Graph preview image (og-image.jpg).

Inputs: tools/src/finda-logo.png (black FIND-A mark on transparent, 800x800)
        docs/assets/img/*.jpg|png and docs/assets/fonts/*.woff2 from design A.
Run:    python3 tools/make-images.py
"""
from pathlib import Path
import tempfile

from fontTools.ttLib import TTFont
from PIL import Image, ImageDraw, ImageFont, ImageChops

ROOT = Path(__file__).resolve().parent.parent
DOCS = ROOT / 'docs'
LOGO = ROOT / 'tools' / 'src' / 'finda-logo.png'
INK = (9, 13, 28)
PAPER = (243, 241, 236)
ACCENT = (217, 198, 165)
MUTED = (198, 203, 216)


def ttf(name: str) -> str:
    """PIL needs TrueType; convert the page's woff2 files once into a temp dir."""
    out = Path(tempfile.gettempdir()) / f'finda-{name}.ttf'
    if not out.exists():
        font = TTFont(DOCS / 'assets' / 'fonts' / f'{name}.woff2')
        font.flavor = None
        font.save(out)
    return str(out)


def white_mark() -> Image.Image:
    src = Image.open(LOGO).convert('RGBA')
    alpha = src.getchannel('A')
    alpha = alpha.crop(alpha.getbbox())
    mark = Image.new('RGBA', alpha.size, PAPER + (255,))
    mark.putalpha(alpha)
    return mark


def square_icon(size: int, pad: float) -> Image.Image:
    canvas = Image.new('RGBA', (size, size), (0, 0, 0, 255))
    mark = white_mark()
    inner = round(size * (1 - 2 * pad))
    scale = inner / max(mark.size)
    mark = mark.resize((round(mark.width * scale), round(mark.height * scale)), Image.LANCZOS)
    canvas.alpha_composite(mark, ((size - mark.width) // 2, (size - mark.height) // 2))
    return canvas


FEATURES = ['lnum']  # lining figures, same as font-variant-numeric: lining-nums on the page


def text_width(draw, text, font, tracking=0):
    return sum(draw.textlength(ch, font=font, features=FEATURES) for ch in text) + tracking * (len(text) - 1)


def draw_centered(draw, y, text, font, fill, tracking=0, width=1200):
    x = (width - text_width(draw, text, font, tracking)) / 2
    for ch in text:
        draw.text((x, y), ch, font=font, fill=fill, features=FEATURES)
        x += draw.textlength(ch, font=font, features=FEATURES) + tracking


def og_image() -> Image.Image:
    w, h = 1200, 630
    sky = Image.open(DOCS / 'assets' / 'img' / 'hero-sky.jpg').convert('RGB')
    scale = w / sky.width
    sky = sky.resize((w, round(sky.height * scale)), Image.LANCZOS)
    top = round(sky.height * 0.06)
    canvas = sky.crop((0, top, w, top + h)).convert('RGBA')

    stars = Image.open(DOCS / 'assets' / 'img' / 'star-field.png').convert('RGBA')
    layer = Image.new('RGBA', (w, h))
    for x in range(0, w, stars.width):
        layer.alpha_composite(stars, (x, 0))
    canvas.alpha_composite(layer)

    shade = Image.new('RGBA', (w, h), INK + (0,))
    sd = ImageDraw.Draw(shade)
    for y in range(h):
        sd.line([(0, y), (w, y)], fill=INK + (int(70 + 60 * (y / h)),))
    canvas.alpha_composite(shade)

    mark = white_mark()
    mh = 112
    mark = mark.resize((round(mark.width * mh / mark.height), mh), Image.LANCZOS)
    canvas.alpha_composite(mark, ((w - mark.width) // 2, 92))

    draw = ImageDraw.Draw(canvas)
    title = ImageFont.truetype(ttf('pretendard-600'), 76)
    serif = ImageFont.truetype(ttf('cormorant-garamond-latin'), 40)
    italic = ImageFont.truetype(ttf('cormorant-garamond-italic-latin'), 30)
    body = ImageFont.truetype(ttf('pretendard-400'), 30)

    draw_centered(draw, 240, 'Homecoming Day', italic, ACCENT)
    draw_centered(draw, 282, 'FIND-A 홈커밍데이', title, PAPER, tracking=-1)
    draw_centered(draw, 400, '2027. 01. 09  SAT  6:00 PM', serif, ACCENT, tracking=3)
    draw_centered(draw, 462, '광화문 보사우러스', body, MUTED)
    return canvas.convert('RGB')


def main():
    icons = DOCS / 'assets' / 'icons'
    og = DOCS / 'assets' / 'og'
    icons.mkdir(parents=True, exist_ok=True)
    og.mkdir(parents=True, exist_ok=True)

    square_icon(512, 0.12).save(icons / 'icon-512.png', optimize=True)
    square_icon(192, 0.12).save(icons / 'icon-192.png', optimize=True)
    square_icon(180, 0.16).convert('RGB').save(icons / 'apple-touch-icon.png', optimize=True)
    square_icon(256, 0.08).save(DOCS / 'favicon.ico', sizes=[(16, 16), (32, 32), (48, 48)])

    og_image().save(og / 'og-image.jpg', quality=90, optimize=True, progressive=True)
    print('done')


if __name__ == '__main__':
    main()
