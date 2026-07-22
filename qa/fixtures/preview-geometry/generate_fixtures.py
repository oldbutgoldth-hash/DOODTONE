#!/usr/bin/env python3
"""
DEPLOY GEOMETRY R1 — Phase E: deterministic geometry fixture generator.

Generates project-owned, entirely synthetic images (simple geometric
corner-marker patterns) with known EXIF Orientation tags, used by the
Preview Geometry Browser/Static suites to prove the app's canonical
decode + EXIF-orientation handling. Never the user's personal photo.

Marker scheme (applied to the DECODED / post-correction appearance,
i.e. what a correctly EXIF-aware browser must show):
  top-left     = red    (255,   0,   0)  <- expectedVisualTopLeftMarker
  top-right    = green  (  0, 170,   0)
  bottom-left  = blue   (  0,   0, 255)
  bottom-right = yellow (230, 200,   0)

For orientation != 1, the stored (encoded) pixel matrix is the INVERSE
transpose of the desired decoded appearance, using the exact mapping
Pillow's own ImageOps.exif_transpose() applies (which mirrors what
browsers implement for `imageOrientation: 'from-image'` /
`image-orientation: from-image`):
    orientation 3 -> decoded = encoded.transpose(ROTATE_180)   (self-inverse)
    orientation 6 -> decoded = encoded.transpose(ROTATE_270)   (inverse: ROTATE_90)
    orientation 8 -> decoded = encoded.transpose(ROTATE_90)    (inverse: ROTATE_270)
So encoded = decoded.transpose(<inverse method>) for each case below.
"""
import json
import os

from PIL import Image, ImageDraw

OUT_DIR = os.path.dirname(os.path.abspath(__file__))

RED = (255, 0, 0)
GREEN = (0, 170, 0)
BLUE = (0, 0, 255)
YELLOW = (230, 200, 0)
WHITE = (255, 255, 255)

ORIENTATION_TAG = 274  # EXIF "Orientation" tag ID


def build_decoded_canonical(width, height):
    """Builds the DESIRED post-correction appearance: 4 solid-color
    quadrants (TL=red, TR=green, BL=blue, BR=yellow) plus a thin white
    corner-index square at the true top-left corner, for a redundant
    position-based cross-check independent of color."""
    img = Image.new('RGB', (width, height), WHITE)
    draw = ImageDraw.Draw(img)
    half_w, half_h = width // 2, height // 2
    draw.rectangle([0, 0, half_w - 1, half_h - 1], fill=RED)
    draw.rectangle([half_w, 0, width - 1, half_h - 1], fill=GREEN)
    draw.rectangle([0, half_h, half_w - 1, height - 1], fill=BLUE)
    draw.rectangle([half_w, half_h, width - 1, height - 1], fill=YELLOW)
    mark = max(4, min(width, height) // 10)
    draw.rectangle([0, 0, mark, mark], outline=WHITE, width=2)
    return img


def save_jpeg_with_orientation(decoded_img, orientation, path):
    if orientation == 1:
        encoded_img = decoded_img
    elif orientation == 3:
        encoded_img = decoded_img.transpose(Image.Transpose.ROTATE_180)
    elif orientation == 6:
        # inverse of ROTATE_270 is ROTATE_90
        encoded_img = decoded_img.transpose(Image.Transpose.ROTATE_90)
    elif orientation == 8:
        # inverse of ROTATE_90 is ROTATE_270
        encoded_img = decoded_img.transpose(Image.Transpose.ROTATE_270)
    else:
        raise ValueError(f'Unsupported orientation for fixture generation: {orientation}')

    # Always write the tag explicitly (including orientation=1) so the
    # manifest's declared exifOrientation is unambiguous and directly
    # machine-verifiable — never relying on "absence of the tag means
    # 1" as an implicit convention downstream tests would have to
    # special-case.
    exif = Image.Exif()
    exif[ORIENTATION_TAG] = orientation
    encoded_img.save(path, 'jpeg', quality=95, exif=exif.tobytes())
    return encoded_img.size  # (encodedWidth, encodedHeight)


def main():
    manifest = []

    # 1. landscape-orientation-1.jpg
    decoded = build_decoded_canonical(800, 600)
    enc_w, enc_h = save_jpeg_with_orientation(decoded, 1, os.path.join(OUT_DIR, 'landscape-orientation-1.jpg'))
    manifest.append({
        'filename': 'landscape-orientation-1.jpg',
        'encodedPixelWidth': enc_w, 'encodedPixelHeight': enc_h,
        'exifOrientation': 1,
        'expectedDecodedWidth': 800, 'expectedDecodedHeight': 600,
        'expectedVisualTopLeftMarker': 'red',
    })

    # 2. portrait-orientation-1.jpg
    decoded = build_decoded_canonical(600, 800)
    enc_w, enc_h = save_jpeg_with_orientation(decoded, 1, os.path.join(OUT_DIR, 'portrait-orientation-1.jpg'))
    manifest.append({
        'filename': 'portrait-orientation-1.jpg',
        'encodedPixelWidth': enc_w, 'encodedPixelHeight': enc_h,
        'exifOrientation': 1,
        'expectedDecodedWidth': 600, 'expectedDecodedHeight': 800,
        'expectedVisualTopLeftMarker': 'red',
    })

    # 3. landscape-orientation-3.jpg (180 degrees — dims unchanged)
    decoded = build_decoded_canonical(800, 600)
    enc_w, enc_h = save_jpeg_with_orientation(decoded, 3, os.path.join(OUT_DIR, 'landscape-orientation-3.jpg'))
    manifest.append({
        'filename': 'landscape-orientation-3.jpg',
        'encodedPixelWidth': enc_w, 'encodedPixelHeight': enc_h,
        'exifOrientation': 3,
        'expectedDecodedWidth': 800, 'expectedDecodedHeight': 600,
        'expectedVisualTopLeftMarker': 'red',
    })

    # 4. landscape-matrix-orientation-6.jpg (decoded landscape, encoded
    #    matrix is portrait-shaped — "matrix" in the filename refers to
    #    the STORED matrix shape, not the final decoded appearance)
    decoded = build_decoded_canonical(800, 600)
    enc_w, enc_h = save_jpeg_with_orientation(decoded, 6, os.path.join(OUT_DIR, 'landscape-matrix-orientation-6.jpg'))
    manifest.append({
        'filename': 'landscape-matrix-orientation-6.jpg',
        'encodedPixelWidth': enc_w, 'encodedPixelHeight': enc_h,
        'exifOrientation': 6,
        'expectedDecodedWidth': 800, 'expectedDecodedHeight': 600,
        'expectedVisualTopLeftMarker': 'red',
    })

    # 5. portrait-matrix-orientation-8.jpg (decoded portrait, encoded
    #    matrix is landscape-shaped)
    decoded = build_decoded_canonical(600, 800)
    enc_w, enc_h = save_jpeg_with_orientation(decoded, 8, os.path.join(OUT_DIR, 'portrait-matrix-orientation-8.jpg'))
    manifest.append({
        'filename': 'portrait-matrix-orientation-8.jpg',
        'encodedPixelWidth': enc_w, 'encodedPixelHeight': enc_h,
        'exifOrientation': 8,
        'expectedDecodedWidth': 600, 'expectedDecodedHeight': 800,
        'expectedVisualTopLeftMarker': 'red',
    })

    # 6. landscape-no-exif.png — no EXIF at all (PNG carries none here)
    decoded = build_decoded_canonical(800, 600)
    png_path = os.path.join(OUT_DIR, 'landscape-no-exif.png')
    decoded.save(png_path, 'png')
    manifest.append({
        'filename': 'landscape-no-exif.png',
        'encodedPixelWidth': 800, 'encodedPixelHeight': 600,
        'exifOrientation': None,
        'expectedDecodedWidth': 800, 'expectedDecodedHeight': 600,
        'expectedVisualTopLeftMarker': 'red',
    })

    output = {
        # Shared sampling contract for every fixture: sample the
        # decoded image at 15% width/15% height (well inside the
        # top-left quadrant, away from any JPEG-compression edge
        # artifacts at the exact corner pixel) and expect it to be
        # closer to red than to the other 3 marker colors, within this
        # per-channel tolerance — never an exact-equality pixel match,
        # since JPEG re-encoding always introduces some color drift.
        'markerSampleRelative': {'x': 0.15, 'y': 0.15},
        'colorMatchToleranceRGB': 60,
        'markerColors': {'red': list(RED), 'green': list(GREEN), 'blue': list(BLUE), 'yellow': list(YELLOW)},
        'fixtures': manifest,
    }
    with open(os.path.join(OUT_DIR, 'manifest.json'), 'w') as f:
        json.dump(output, f, indent=2)
        f.write('\n')

    print(f'Generated {len(manifest)} fixtures + manifest.json in {OUT_DIR}')


if __name__ == '__main__':
    main()
