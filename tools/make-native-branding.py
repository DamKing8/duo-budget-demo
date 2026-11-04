#!/usr/bin/env python3
"""Build Android and Capacitor iOS icons and splashes from icons/icon-512.png and icons/logo-mark.webp.

Android adaptive icon: navy background sampled from the PWA icon, foreground is the
transparent mark kept inside the center safe zone. Legacy launcher icons are the full
PWA icon. Splashes are the mark centered on the app cream background (#FBF7EF).
"""
import os
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CREAM = (0xFB, 0xF7, 0xEF, 255)
RES = os.path.join(ROOT, 'android', 'app', 'src', 'main', 'res')
IOS_ICON = os.path.join(ROOT, 'capacitor-ios', 'App', 'App', 'Assets.xcassets', 'AppIcon.appiconset', 'AppIcon-512@2x.png')
IOS_SPLASH = os.path.join(ROOT, 'capacitor-ios', 'App', 'App', 'Assets.xcassets', 'Splash.imageset')


def load_mark():
    mark_path = os.path.join(ROOT, 'icons', 'logo-mark.webp')
    mark = Image.open(mark_path).convert('RGBA')
    bbox = mark.getbbox()
    if bbox:
        mark = mark.crop(bbox)
    return mark


def load_icon():
    return Image.open(os.path.join(ROOT, 'icons', 'icon-512.png')).convert('RGBA')


def contain(src, size, scale):
    canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    side = max(1, int(round(size * scale)))
    fitted = src.resize((side, side), Image.Resampling.LANCZOS)
    canvas.paste(fitted, ((size - side) // 2, (size - side) // 2), fitted)
    return canvas


def splash(w, h, mark):
    im = Image.new('RGBA', (w, h), CREAM)
    side = max(1, int(round(min(w, h) * 0.28)))
    fitted = mark.resize((side, side), Image.Resampling.LANCZOS)
    im.paste(fitted, ((w - side) // 2, (h - side) // 2), fitted)
    return im.convert('RGB')


def replace_pngs(directory, paint):
    for name in os.listdir(directory):
        if not name.endswith('.png'):
            continue
        path = os.path.join(directory, name)
        with Image.open(path) as current:
            size = current.size
        paint(path, size)


def main():
    icon = load_icon()
    mark = load_mark()
    navy = icon.getpixel((2, 2))
    if navy[3] != 255:
        raise SystemExit('icon-512 corner is not an opaque background')
    print('launcher background #%02X%02X%02X' % navy[:3])

    legacy_dirs = [d for d in os.listdir(RES) if d.startswith('mipmap-') and d != 'mipmap-anydpi-v26']
    for folder in legacy_dirs:
        directory = os.path.join(RES, folder)
        def paint(path, size, folder=folder):
            side = size[0]
            if 'foreground' in os.path.basename(path):
                # Adaptive foreground is larger than the legacy icon. Keep the mark in the safe zone.
                image = contain(mark, side, 0.58)
            else:
                image = icon.resize((side, side), Image.Resampling.LANCZOS)
            image.save(path, 'PNG')
        replace_pngs(directory, paint)

    splash_dirs = [d for d in os.listdir(RES) if d.startswith('drawable')]
    for folder in splash_dirs:
        directory = os.path.join(RES, folder)
        if not os.path.isdir(directory):
            continue
        def paint(path, size):
            if os.path.basename(path) != 'splash.png':
                return
            splash(size[0], size[1], mark).save(path, 'PNG')
        replace_pngs(directory, paint)

    icon.resize((1024, 1024), Image.Resampling.LANCZOS).save(IOS_ICON, 'PNG')
    for name in os.listdir(IOS_SPLASH):
        if not name.endswith('.png'):
            continue
        path = os.path.join(IOS_SPLASH, name)
        with Image.open(path) as current:
            size = current.size
        splash(size[0], size[1], mark).save(path, 'PNG')

    bg = os.path.join(RES, 'values', 'ic_launcher_background.xml')
    with open(bg, 'w', encoding='utf-8') as handle:
        handle.write(
            '<?xml version="1.0" encoding="utf-8"?>\n'
            '<resources>\n'
            '    <color name="ic_launcher_background">#%02X%02X%02X</color>\n'
            '</resources>\n' % navy[:3]
        )
    print('wrote android and capacitor-ios branding')


if __name__ == '__main__':
    main()
