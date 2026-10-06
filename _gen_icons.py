"""Generate PWA icons: three macro arcs around a lime centre. Run: python _gen_icons.py"""
from PIL import Image, ImageDraw
import os

OUT = os.path.dirname(os.path.abspath(__file__))
BG = (15, 16, 13, 255)
ARCS = [((124, 196, 255), -90, 40), ((255, 211, 107), 50, 150), ((255, 143, 122), 160, 255)]
LIME = (196, 241, 106)


def make(size, maskable=False):
    s = 4  # supersample
    S = size * s
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if maskable:
        d.rectangle([0, 0, S, S], fill=BG)
        inset = S * 0.22
    else:
        d.rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.23), fill=BG)
        inset = S * 0.17
    box = [inset, inset, S - inset, S - inset]
    w = int(S * 0.085)
    d.ellipse(box, outline=(45, 49, 39), width=w)
    for col, a, b in ARCS:
        d.arc(box, a, b, fill=col, width=w)
    c = S / 2
    r = S * 0.11
    d.ellipse([c - r, c - r, c + r, c + r], fill=LIME)
    return img.resize((size, size), Image.LANCZOS)


for n in (192, 512):
    make(n).save(os.path.join(OUT, f'icon-{n}.png'))
make(512, True).save(os.path.join(OUT, 'icon-maskable-512.png'))
print('icons written')
