"""Generate fnOS application icons. Requires Pillow: python3 -m pip install Pillow."""
from pathlib import Path
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parent.parent
for size in (64, 256):
    scale = size / 256
    def q(v): return round(v * scale)

    im = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    bg = (16, 33, 43, 255)
    accent = (90, 230, 198, 255)
    d.rounded_rectangle([q(0), q(0), q(255), q(255)], radius=q(55), fill=bg)
    d.rounded_rectangle([q(40), q(60), q(215), q(196)], radius=q(26), outline=accent, width=max(2,q(14)))
    d.ellipse([q(87), q(87), q(169), q(169)], outline=accent, width=max(2,q(12)))
    d.ellipse([q(112), q(112), q(144), q(144)], fill=accent)
    d.line([(q(81),q(58)),(q(97),q(40)),(q(159),q(40)),(q(175),q(58))],fill=accent,width=max(2,q(12)),joint='curve')
    d.line([(q(128),q(184)),(q(128),q(219))],fill=accent,width=max(2,q(10)))
    d.line([(q(111),q(203)),(q(128),q(220)),(q(145),q(203))],fill=accent,width=max(2,q(10)),joint='curve')
    package_file = root / 'fnos' / ('ICON_256.PNG' if size == 256 else 'ICON.PNG')
    desktop_file = root / 'fnos' / 'ui' / 'images' / f'icon_{size}.png'
    desktop_file.parent.mkdir(parents=True, exist_ok=True)
    im.save(package_file)
    im.save(desktop_file)
    print(package_file, desktop_file)
