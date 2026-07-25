#!/usr/bin/env python3
"""
LOCAL-FIRST GEOMETRY R3 -- Phase C2: photo-like, full-app-eligible EXIF
orientation fixture generator.

Unlike qa/fixtures/preview-geometry/ (deliberately synthetic solid-color
corner-marker test patterns, used ONLY by the decoder/render-level Phase
C1 suite), these fixtures must survive the REAL Analysis/Safety
pipeline and reach canGeneratePreview=true / V2 Render Plan / Observation
-- exactly what a synthetic marker image is not designed to do.

Base visual content: qa/fixtures/epic-2e-j/neutral-balanced.png, already
proven (SAFE RECOVERY + DEPLOY GEOMETRY R2 -- Phase C) to reach a real
"Preview Ready" state through the actual app. It is a smooth, low-
contrast neutral gradient (sampled channel range ~100-139) -- genuinely
photo-like, nothing like a marker block -- which is why it clears
Safety cleanly.

For the two portrait fixtures, the base content itself is transposed
(rotated) so the DECODED appearance is genuinely portrait-shaped (600x800),
not merely a landscape image force-labeled portrait -- "preserve visual
image content" per the spec, applied consistently across orientations.

Uses the exact same encode-time inverse-transpose + EXIF tag 274
technique as qa/fixtures/preview-geometry/generate_fixtures.py, so the
same qa/helpers/exif-orientation-reader.mjs parser this project already
trusts can verify every fixture's encoded tag during test setup.
"""
import json
import os

from PIL import Image

OUT_DIR = os.path.dirname(os.path.abspath(__file__))
BASE_PNG = os.path.join(OUT_DIR, '..', 'neutral-balanced.png')
ORIENTATION_TAG = 274


def save_jpeg_with_orientation(decoded_img, orientation, path):
    if orientation == 1:
        encoded_img = decoded_img
    elif orientation == 3:
        encoded_img = decoded_img.transpose(Image.Transpose.ROTATE_180)
    elif orientation == 6:
        encoded_img = decoded_img.transpose(Image.Transpose.ROTATE_90)   # inverse of ROTATE_270
    elif orientation == 8:
        encoded_img = decoded_img.transpose(Image.Transpose.ROTATE_270)  # inverse of ROTATE_90
    else:
        raise ValueError(f'Unsupported orientation: {orientation}')

    exif = Image.Exif()
    exif[ORIENTATION_TAG] = orientation
    encoded_img.save(path, 'jpeg', quality=95, exif=exif.tobytes())
    return encoded_img.size


def main():
    base = Image.open(BASE_PNG).convert('RGB')  # 800x600 landscape, photo-like gradient
    landscape_decoded = base
    portrait_decoded = base.transpose(Image.Transpose.ROTATE_90)  # genuinely 600x800 portrait content

    manifest = []

    enc_w, enc_h = save_jpeg_with_orientation(landscape_decoded, 1, os.path.join(OUT_DIR, 'ready-landscape-orientation-1.jpg'))
    manifest.append({'filename': 'ready-landscape-orientation-1.jpg', 'encodedPixelWidth': enc_w, 'encodedPixelHeight': enc_h,
                      'exifOrientation': 1, 'expectedDecodedWidth': 800, 'expectedDecodedHeight': 600})

    enc_w, enc_h = save_jpeg_with_orientation(portrait_decoded, 1, os.path.join(OUT_DIR, 'ready-portrait-orientation-1.jpg'))
    manifest.append({'filename': 'ready-portrait-orientation-1.jpg', 'encodedPixelWidth': enc_w, 'encodedPixelHeight': enc_h,
                      'exifOrientation': 1, 'expectedDecodedWidth': 600, 'expectedDecodedHeight': 800})

    enc_w, enc_h = save_jpeg_with_orientation(landscape_decoded, 3, os.path.join(OUT_DIR, 'ready-landscape-orientation-3.jpg'))
    manifest.append({'filename': 'ready-landscape-orientation-3.jpg', 'encodedPixelWidth': enc_w, 'encodedPixelHeight': enc_h,
                      'exifOrientation': 3, 'expectedDecodedWidth': 800, 'expectedDecodedHeight': 600})

    enc_w, enc_h = save_jpeg_with_orientation(landscape_decoded, 6, os.path.join(OUT_DIR, 'ready-landscape-matrix-orientation-6.jpg'))
    manifest.append({'filename': 'ready-landscape-matrix-orientation-6.jpg', 'encodedPixelWidth': enc_w, 'encodedPixelHeight': enc_h,
                      'exifOrientation': 6, 'expectedDecodedWidth': 800, 'expectedDecodedHeight': 600})

    enc_w, enc_h = save_jpeg_with_orientation(portrait_decoded, 8, os.path.join(OUT_DIR, 'ready-portrait-matrix-orientation-8.jpg'))
    manifest.append({'filename': 'ready-portrait-matrix-orientation-8.jpg', 'encodedPixelWidth': enc_w, 'encodedPixelHeight': enc_h,
                      'exifOrientation': 8, 'expectedDecodedWidth': 600, 'expectedDecodedHeight': 800})

    png_path = os.path.join(OUT_DIR, 'ready-landscape-no-exif.png')
    landscape_decoded.save(png_path, 'png')
    manifest.append({'filename': 'ready-landscape-no-exif.png', 'encodedPixelWidth': 800, 'encodedPixelHeight': 600,
                      'exifOrientation': None, 'expectedDecodedWidth': 800, 'expectedDecodedHeight': 600})

    with open(os.path.join(OUT_DIR, 'manifest.json'), 'w') as f:
        json.dump({'sourceFixture': 'qa/fixtures/epic-2e-j/neutral-balanced.png', 'fixtures': manifest}, f, indent=2)
        f.write('\n')

    print(f'Generated {len(manifest)} full-app-eligible fixtures + manifest.json in {OUT_DIR}')


if __name__ == '__main__':
    main()
