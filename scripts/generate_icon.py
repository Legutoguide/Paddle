"""
Generates the Sponsor QR Manager app icon: a minimal abstract mark combining
a QR "finder pattern" corner with a coupon-style corner notch, in the app's
dark/gold visual identity. Produces resources/icon.png (512x512) and
resources/icon.ico (multi-size, for the Windows installer/taskbar/titlebar).
"""
from PIL import Image, ImageDraw

BG = (10, 14, 26, 255)          # base-bg (deep navy)
GOLD = (33, 150, 243, 255)      # accent (electric blue)
GOLD_DIM = (34, 211, 238, 255)  # cyan

def draw_icon(size: int) -> Image.Image:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    pad = size * 0.08
    radius = size * 0.22
    draw.rounded_rectangle([pad, pad, size - pad, size - pad], radius=radius, fill=BG)

    # QR finder-pattern square (top-left), classic nested-square motif.
    fp_size = size * 0.34
    fp_x = size * 0.16
    fp_y = size * 0.16
    draw.rectangle([fp_x, fp_y, fp_x + fp_size, fp_y + fp_size], fill=GOLD)
    inset1 = fp_size * 0.20
    draw.rectangle([fp_x + inset1, fp_y + inset1, fp_x + fp_size - inset1, fp_y + fp_size - inset1], fill=BG)
    inset2 = fp_size * 0.38
    draw.rectangle([fp_x + inset2, fp_y + inset2, fp_x + fp_size - inset2, fp_y + fp_size - inset2], fill=GOLD)

    # Scattered small "data module" dots, bottom-right, suggesting QR data.
    dot = size * 0.055
    gap = dot * 1.7
    start_x = size * 0.54
    start_y = size * 0.54
    pattern = [
        (0, 0), (1, 0), (0, 1), (2, 1), (1, 2), (2, 2), (3, 0), (0, 3), (3, 3),
    ]
    for cx, cy in pattern:
        x = start_x + cx * gap
        y = start_y + cy * gap
        if x + dot < size - pad and y + dot < size - pad:
            draw.rectangle([x, y, x + dot, y + dot], fill=GOLD if (cx + cy) % 2 == 0 else GOLD_DIM)

    return img

def main():
    import os
    os.makedirs("resources", exist_ok=True)

    icon_512 = draw_icon(512)
    icon_512.save("resources/icon.png")

    sizes = [16, 24, 32, 48, 64, 128, 256]
    imgs = [draw_icon(s) for s in sizes]
    imgs[-1].save("resources/icon.ico", format="ICO", sizes=[(s, s) for s in sizes], append_images=imgs[:-1])

    draw_icon(256).save("resources/icon-256.png")
    draw_icon(32).save("build/icon.png")  # generic fallback used by some tooling

    print("Generated resources/icon.png, resources/icon.ico, resources/icon-256.png")

if __name__ == "__main__":
    main()
