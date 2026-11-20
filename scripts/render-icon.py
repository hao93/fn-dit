"""Render the simple repo-native archive mark at fnOS icon sizes (Pillow)."""
from pathlib import Path
from PIL import Image, ImageDraw
root=Path(__file__).resolve().parent.parent
scale=4
im=Image.new('RGBA',(256*scale,256*scale),(0,0,0,0))
d=ImageDraw.Draw(im)
def box(v): return tuple(round(x*scale) for x in v)
fg='#123F36'
d.rounded_rectangle(box((8,8,248,248)),radius=56*scale,fill='#56D8B8')
def stroke(points,width=14):
    points=[(x*scale,y*scale) for x,y in points]
    d.line(points,fill=fg,width=width*scale,joint='curve')
    r=width*scale/2
    for x,y in points:
        d.ellipse((round(x-r),round(y-r),round(x+r),round(y+r)),fill=fg)
stroke([(128,66),(128,145)])
stroke([(103,120),(128,145),(153,120)])
# Sample the rounded tray centerline, avoiding raster arc edge seams.
import math
tray=[(70,157),(70,180)]
tray += [(86+16*math.cos(math.radians(a)),180+16*math.sin(math.radians(a))) for a in range(180,89,-3)]
tray += [(170,196)]
tray += [(170+16*math.cos(math.radians(a)),180+16*math.sin(math.radians(a))) for a in range(90,-1,-3)]
tray += [(186,157)]
stroke(tray)
for size in (64,256):
    image=im.resize((size,size),Image.Resampling.LANCZOS)
    package=root/'fnos'/('ICON.PNG' if size==64 else 'ICON_256.PNG')
    desktop=root/'fnos'/'ui'/'images'/f'icon_{size}.png'
    image.save(package);image.save(desktop)
    if size==256: image.save(root/'app'/'ui'/'icon.png')
    print(package)
