/**
 * Digit recognition using Tesseract.js OCR.
 * Port of Python TesseractDigitRecognizer with matching behavior.
 */
import { createWorker, Worker, PSM } from 'tesseract.js';

let workerPSM6: Worker | null = null;
let workerPSM10: Worker | null = null;
let initPromise: Promise<void> | null = null;

// Detect Node.js environment
const isNode = typeof window === 'undefined';

async function initWorkers(): Promise<void> {
  if (workerPSM6 && workerPSM10) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const createOpts = isNode
      ? {}
      : {
          workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@7/dist/worker.min.js',
          corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@6/tesseract-core.wasm.js',
        };

    // Create two workers: one for PSM 6, one for PSM 10 (SINGLE_CHAR)
    const [w6, w10] = await Promise.all([
      createWorker('eng', 1, createOpts),
      createWorker('eng', 1, createOpts),
    ]);

    // PSM 6: Assume a single uniform block of text
    await w6.setParameters({
      tessedit_char_whitelist: '0123456789O',
      tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
    });

    // PSM 10: Treat the image as a single character
    await w10.setParameters({
      tessedit_char_whitelist: '0123456789O',
      tessedit_pageseg_mode: PSM.SINGLE_CHAR,
    });

    workerPSM6 = w6;
    workerPSM10 = w10;
  })();

  return initPromise;
}

// ============================================================================
// Zero/6 disambiguation using shape analysis (port of Python _is_zero_by_shape)
// ============================================================================

/**
 * Distinguish '0' from '6' by checking for internal holes and vertical symmetry.
 * - '0' has a hole (internal contour) and is vertically symmetric.
 * - '6' has a hole in the bottom but is NOT vertically symmetric.
 */
function isZeroByShape(mask: Uint8Array, width: number, height: number): boolean {
  if (width === 0 || height === 0) return false;

  // Flood-fill based hole detection:
  // Fill from outside edges. Anything not reached that is background = hole.
  const visited = new Uint8Array(width * height);

  // BFS from all border background pixels
  const queue: number[] = [];
  for (let x = 0; x < width; x++) {
    if (mask[x] === 0 && !visited[x]) { visited[x] = 1; queue.push(x); }
    const bottom = (height - 1) * width + x;
    if (mask[bottom] === 0 && !visited[bottom]) { visited[bottom] = 1; queue.push(bottom); }
  }
  for (let y = 0; y < height; y++) {
    const left = y * width;
    if (mask[left] === 0 && !visited[left]) { visited[left] = 1; queue.push(left); }
    const right = y * width + (width - 1);
    if (mask[right] === 0 && !visited[right]) { visited[right] = 1; queue.push(right); }
  }

  let qi = 0;
  while (qi < queue.length) {
    const idx = queue[qi++];
    const x = idx % width;
    const y = (idx - x) / width;

    const neighbors = [
      y > 0 ? idx - width : -1,
      y < height - 1 ? idx + width : -1,
      x > 0 ? idx - 1 : -1,
      x < width - 1 ? idx + 1 : -1,
    ];

    for (const nIdx of neighbors) {
      if (nIdx >= 0 && !visited[nIdx] && mask[nIdx] === 0) {
        visited[nIdx] = 1;
        queue.push(nIdx);
      }
    }
  }

  // Count hole pixels (background not reached from border)
  let holePixels = 0;
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] === 0 && !visited[i]) holePixels++;
  }

  const hasHole = holePixels > 10; // At least 10 pixels to count as a hole

  if (!hasHole) return false;

  // Check vertical symmetry
  const midX = Math.floor(width / 2);
  let matchCount = 0;
  let totalCount = 0;

  for (let y = 0; y < height; y++) {
    const minW = Math.min(midX, width - midX);
    for (let dx = 0; dx < minW; dx++) {
      const leftVal = mask[y * width + (midX - 1 - dx)] > 0 ? 1 : 0;
      const rightVal = mask[y * width + (midX + dx)] > 0 ? 1 : 0;
      if (leftVal === rightVal) matchCount++;
      totalCount++;
    }
  }

  const symmetry = totalCount > 0 ? matchCount / totalCount : 0;
  return symmetry > 0.5;
}

// ============================================================================
// Image preprocessing
// ============================================================================

interface MaskImageResult {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/**
 * Convert a mask to a black-on-white image suitable for Tesseract.
 * Matches Python: pad=20, invert (black digit on white background).
 * For small images, upscale to ensure Tesseract.js WASM can read them.
 */
function maskToImageData(
  mask: Uint8Array,
  srcWidth: number,
  _srcHeight: number,
  x0: number,
  y0: number,
  w: number,
  h: number,
  rotated: boolean
): MaskImageResult {
  const pad = 20; // Match Python padding

  // Calculate base dimensions after optional rotation
  const baseW = rotated ? h : w;
  const baseH = rotated ? w : h;

  // Upscale small images so Tesseract.js WASM can handle them
  // Target at least 64px for the digit height
  const MIN_DIM = 64;
  let scale = 1;
  if (Math.max(baseW, baseH) < MIN_DIM) {
    scale = Math.ceil(MIN_DIM / Math.max(baseW, baseH));
  }

  const scaledW = baseW * scale;
  const scaledH = baseH * scale;
  const outW = scaledW + pad * 2;
  const outH = scaledH + pad * 2;

  const data = new Uint8ClampedArray(outW * outH * 4);

  // Fill with white background (Tesseract expects black text on white bg)
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 255;      // R
    data[i + 1] = 255;  // G
    data[i + 2] = 255;  // B
    data[i + 3] = 255;  // A
  }

  // Copy mask as BLACK pixels (inverted: foreground = black)
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const srcIdx = (y0 + dy) * srcWidth + (x0 + dx);
      if (mask[srcIdx] > 0) {
        let baseX: number, baseY: number;
        if (rotated) {
          // Rotate 90° clockwise: (dx, dy) → (h-1-dy, dx)
          baseX = h - 1 - dy;
          baseY = dx;
        } else {
          baseX = dx;
          baseY = dy;
        }

        // Fill scaled block
        for (let sy = 0; sy < scale; sy++) {
          for (let sx = 0; sx < scale; sx++) {
            const outX = baseX * scale + sx + pad;
            const outY = baseY * scale + sy + pad;
            const dstIdx = (outY * outW + outX) * 4;
            data[dstIdx] = 0;       // R - black
            data[dstIdx + 1] = 0;   // G
            data[dstIdx + 2] = 0;   // B
            // Alpha stays 255
          }
        }
      }
    }
  }

  return { data, width: outW, height: outH };
}

// ============================================================================
// Main recognition
// ============================================================================

export async function recognizeDigit(
  mask: Uint8Array,
  width: number,
  height: number,
  rotated: boolean = false
): Promise<number> {
  if (width === 0 || height === 0) return 0;

  // Find content bounds
  let minX = width, maxX = 0, minY = height, maxY = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (mask[y * width + x] > 0) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
  }

  if (maxX < minX || maxY < minY) return 0;

  const w = maxX - minX + 1;
  const h = maxY - minY + 1;
  if (w < 3 || h < 3) return 0;

  // Create cropped mask for shape analysis (before rotation, tight bounds)
  const croppedMask = new Uint8Array(w * h);
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      croppedMask[dy * w + dx] = mask[(minY + dy) * width + (minX + dx)];
    }
  }

  // If rotated, rotate the cropped mask for shape analysis
  let shapeMask: Uint8Array;
  let shapeW: number, shapeH: number;
  if (rotated) {
    shapeW = h;
    shapeH = w;
    shapeMask = new Uint8Array(shapeW * shapeH);
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        // Rotate 90° clockwise: (dx, dy) -> (h-1-dy, dx)
        const newX = h - 1 - dy;
        const newY = dx;
        shapeMask[newY * shapeW + newX] = croppedMask[dy * w + dx];
      }
    }
  } else {
    shapeMask = croppedMask;
    shapeW = w;
    shapeH = h;
  }

  // Create ImageData (black on white)
  const imgResult = maskToImageData(mask, width, height, minX, minY, w, h, rotated);

  // Convert to format suitable for Tesseract
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let inputImage: any;
  if (isNode) {
    const { createCanvas } = await import('canvas');
    const canvas = createCanvas(imgResult.width, imgResult.height);
    const ctx = canvas.getContext('2d');
    const imageData = new (globalThis.ImageData ?? (await import('canvas')).ImageData)(
      imgResult.data as any, imgResult.width, imgResult.height
    );
    ctx.putImageData(imageData as any, 0, 0);
    inputImage = canvas.toBuffer('image/png');
  } else {
    // Use Canvas instead of raw ImageData — more reliable across tesseract.js versions
    const canvas = document.createElement('canvas');
    canvas.width = imgResult.width;
    canvas.height = imgResult.height;
    const ctx = canvas.getContext('2d')!;
    ctx.putImageData(new ImageData(imgResult.data as any, imgResult.width, imgResult.height), 0, 0);
    inputImage = canvas;
  }

  // Run OCR with dual PSM strategy (matching Python)
  try {
    await initWorkers();

    for (const ocrWorker of [workerPSM6!, workerPSM10!]) {
      const result = await ocrWorker.recognize(inputImage);
      const text = result.data.text.trim();

      if (isNode) {
        const psmLabel = ocrWorker === workerPSM6 ? 'PSM6' : 'PSM10';
        console.log(`OCR[${psmLabel}]: text="${text}" conf=${result.data.confidence.toFixed(1)} size=${w}x${h} rotated=${rotated}`);
      }

      // Parse each character in the result
      for (const char of text) {
        if (char >= '0' && char <= '9') {
          const digit = parseInt(char, 10);

          // Disambiguate 6 vs 0 using shape analysis (like Python)
          if (digit === 6 && isZeroByShape(shapeMask, shapeW, shapeH)) {
            if (isNode) console.log(`  -> 6 corrected to 0 by shape analysis`);
            return 0;
          }

          return digit;
        }
        if (char === 'O') {
          return 0;
        }
      }
    }
  } catch (ocrError) {
    // OCR failed — fall back to heuristic
    if (isNode) console.error('OCR error:', ocrError);
  }

  // Fallback to heuristic if OCR fails or returns nothing
  if (isNode) console.log(`  -> heuristic fallback`);
  return heuristicRecognize(shapeMask, shapeW, shapeH);
}

// ============================================================================
// Heuristic fallback
// ============================================================================

function heuristicRecognize(
  mask: Uint8Array,
  w: number,
  h: number
): number {
  let total = 0, center = 0, topHalf = 0;

  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      if (mask[dy * w + dx] > 0) {
        total++;
        if (dy < h / 2) topHalf++;
        if (dx > w * 0.3 && dx < w * 0.7 && dy > h * 0.3 && dy < h * 0.7) {
          center++;
        }
      }
    }
  }

  if (total === 0) return 0;

  const rectArea = w * h;
  const fillRatio = total / rectArea;
  const centerRatio = center / total;
  const topRatio = topHalf / total;
  const aspect = w / h;

  // Check for hole (0)
  if (isZeroByShape(mask, w, h)) return 0;

  // Simple heuristics
  if (aspect < 0.5 && fillRatio < 0.5) return 1;
  if (centerRatio < 0.1 && Math.abs(topRatio - 0.5) < 0.15) return 0;
  if (fillRatio > 0.35 && topRatio > 0.55) return 4;
  if (fillRatio > 0.35 && topRatio < 0.45) return 5;
  if (fillRatio > 0.3 && centerRatio > 0.1) return 3;

  return 2;
}

/**
 * Synchronous fallback for when OCR is not initialized
 */
export function recognizeDigitSync(
  mask: Uint8Array,
  width: number,
  height: number,
  rotated: boolean = false
): number {
  if (width === 0 || height === 0) return 0;

  let minX = width, maxX = 0, minY = height, maxY = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (mask[y * width + x] > 0) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
  }

  if (maxX < minX || maxY < minY) return 0;

  const w = maxX - minX + 1;
  const h = maxY - minY + 1;

  // Crop mask
  const croppedMask = new Uint8Array(w * h);
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      croppedMask[dy * w + dx] = mask[(minY + dy) * width + (minX + dx)];
    }
  }

  // Rotate if needed
  let shapeMask: Uint8Array;
  let shapeW: number, shapeH: number;
  if (rotated) {
    shapeW = h;
    shapeH = w;
    shapeMask = new Uint8Array(shapeW * shapeH);
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        // Rotate 90° clockwise: (dx, dy) -> (h-1-dy, dx)
        const newX = h - 1 - dy;
        const newY = dx;
        shapeMask[newY * shapeW + newX] = croppedMask[dy * w + dx];
      }
    }
  } else {
    shapeMask = croppedMask;
    shapeW = w;
    shapeH = h;
  }

  return heuristicRecognize(shapeMask, shapeW, shapeH);
}

/**
 * Terminate the workers when no longer needed
 */
export async function terminateWorker(): Promise<void> {
  if (workerPSM6) {
    await workerPSM6.terminate();
    workerPSM6 = null;
  }
  if (workerPSM10) {
    await workerPSM10.terminate();
    workerPSM10 = null;
  }
  initPromise = null;
}
