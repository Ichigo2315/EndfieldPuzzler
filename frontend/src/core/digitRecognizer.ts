/**
 * Digit recognition using Neural Network.
 * High-precision recognition for game constraints.
 */
import { recognizeDigitNN } from './digitNN';

/**
 * Recognize a digit from a binary mask.
 * Handles cropping to content and optional rotation.
 * 
 * @param mask - Full-frame binary mask (255=foreground)
 * @param width - Frame width
 * @param height - Frame height
 * @param rotated - Whether the image needs 90 deg clockwise rotation to be upright
 * @returns Recognized digit (0-9)
 */
export async function recognizeDigit(
  mask: Uint8Array,
  width: number,
  height: number,
  rotated: boolean = false
): Promise<number> {
  if (width === 0 || height === 0) return 0;

  // 1. Find content bounds (cropping)
  let minX = width, maxX = 0, minY = height, maxY = 0;
  let hasContent = false;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (mask[y * width + x] > 0) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
        hasContent = true;
      }
    }
  }

  if (!hasContent) return 0;

  const w = maxX - minX + 1;
  const h = maxY - minY + 1;

  // Ignore tiny noise
  if (w < 3 || h < 3) return 0;

  // 2. Extract cropped mask
  const croppedMask = new Uint8Array(w * h);
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      croppedMask[dy * w + dx] = mask[(minY + dy) * width + (minX + dx)];
    }
  }

  // 3. Handle rotation if needed (NN expects upright digits)
  let finalMask: Uint8Array;
  let finalW: number, finalH: number;

  if (rotated) {
    finalW = h;
    finalH = w;
    finalMask = new Uint8Array(finalW * finalH);
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        // Rotate 90° clockwise: (dx, dy) -> (h-1-dy, dx)
        const newX = h - 1 - dy;
        const newY = dx;
        finalMask[newY * finalW + newX] = croppedMask[dy * w + dx];
      }
    }
  } else {
    finalMask = croppedMask;
    finalW = w;
    finalH = h;
  }

  // 4. Run Neural Network recognition
  const result = await recognizeDigitNN(finalMask, finalW, finalH);

  // Return result, or 0 if recognition failed
  return result >= 0 ? result : 0;
}

/**
 * Cleanup function (no-op since we moved to ONNX-web)
 */
export async function terminateWorker(): Promise<void> {
  // No-op
}
