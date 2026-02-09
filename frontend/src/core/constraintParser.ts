/**
 * Constraint strip parser - TypeScript port of Python implementation.
 */
import type { ColorCode, ConstraintInfo, ConstraintStripResult, ConstraintValue, DisplayMode } from '../types/puzzle';
import { COLOR_RANGES, COLOR_ORDER } from './config';
import { recognizeDigit } from './digitRecognizer';
import { debugLogger } from './monitor';

// ============================================================================
// Types
// ============================================================================

interface HSVPixel { h: number; s: number; v: number; }
interface Contour { x: number; y: number; w: number; h: number; cx: number; cy: number; area: number; }
interface DigitInfo extends Contour { color: ColorCode; type: 'digit' | 'zero'; }
interface BarInfo extends Contour { color: ColorCode; type: 'bar'; }
type Element = (DigitInfo | BarInfo | (Contour & { type: 'zero' }));

// ============================================================================
// Image utilities
// ============================================================================

interface ImageMatrix {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  channels: number;
}

function rgbToHsv(r: number, g: number, b: number): HSVPixel {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;

  let h = 0;
  const s = max === 0 ? 0 : d / max;
  const v = max;

  if (d !== 0) {
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }

  return { h: h * 180, s: s * 255, v: v * 255 };
}

function getPixel(img: ImageMatrix, x: number, y: number): [number, number, number] {
  const idx = (y * img.width + x) * img.channels;
  return [img.data[idx], img.data[idx + 1], img.data[idx + 2]];
}

function createColorMask(img: ImageMatrix, code: ColorCode, relaxed = false): Uint8Array {
  const mask = new Uint8Array(img.width * img.height);
  const [[hMin, sMin, vMin], [hMax, sMax, vMax]] = COLOR_RANGES[code];

  const sMinAdj = relaxed ? Math.max(0, sMin - 40) : sMin;
  const vMinAdj = relaxed ? Math.max(0, vMin - 60) : vMin;

  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const [r, g, b] = getPixel(img, x, y);
      const hsv = rgbToHsv(r, g, b);

      if (hsv.h >= hMin && hsv.h <= hMax &&
          hsv.s >= sMinAdj && hsv.s <= sMax &&
          hsv.v >= vMinAdj && hsv.v <= vMax) {
        mask[y * img.width + x] = 255;
      }
    }
  }
  return mask;
}

function countMaskPixels(mask: Uint8Array): number {
  let count = 0;
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] > 0) count++;
  }
  return count;
}

// ── Morphological operations (matching Python cv2.morphologyEx) ──

function dilate3x3(mask: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let hit = false;
      for (let dy = -1; dy <= 1 && !hit; dy++) {
        for (let dx = -1; dx <= 1 && !hit; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx >= 0 && nx < w && ny >= 0 && ny < h && mask[ny * w + nx] > 0) hit = true;
        }
      }
      if (hit) out[y * w + x] = 255;
    }
  }
  return out;
}

function erode3x3(mask: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let all = true;
      for (let dy = -1; dy <= 1 && all; dy++) {
        for (let dx = -1; dx <= 1 && all; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || nx >= w || ny < 0 || ny >= h || mask[ny * w + nx] === 0) all = false;
        }
      }
      if (all) out[y * w + x] = 255;
    }
  }
  return out;
}

/** morphClose then morphOpen with 3×3 kernel (matches Python pipeline) */
function morphCloseOpen(mask: Uint8Array, w: number, h: number): Uint8Array {
  // Close = dilate → erode  (fills small gaps)
  let m = dilate3x3(mask, w, h);
  m = erode3x3(m, w, h);
  // Open = erode → dilate  (removes small noise)
  m = erode3x3(m, w, h);
  m = dilate3x3(m, w, h);
  return m;
}

/** Count border pixels of a connected component to approximate contour perimeter */
function countBorderPixels(mask: Uint8Array, w: number, h: number, cnt: Contour): number {
  let border = 0;
  for (let dy = 0; dy < cnt.h; dy++) {
    for (let dx = 0; dx < cnt.w; dx++) {
      const x = cnt.x + dx, y = cnt.y + dy;
      if (mask[y * w + x] === 0) continue;
      // Check if any 4-neighbor is background or border
      let isBorder = false;
      for (const [nx, ny] of [[x-1,y],[x+1,y],[x,y-1],[x,y+1]] as [number,number][]) {
        if (nx < 0 || nx >= w || ny < 0 || ny >= h || mask[ny * w + nx] === 0) {
          isBorder = true; break;
        }
      }
      if (isBorder) border++;
    }
  }
  return border;
}

function findContours(mask: Uint8Array, width: number, height: number): Contour[] {
  const visited = new Uint8Array(width * height);
  const contours: Contour[] = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (mask[idx] === 0 || visited[idx]) continue;

      const queue: [number, number][] = [[x, y]];
      visited[idx] = 1;

      let minX = x, maxX = x, minY = y, maxY = y;
      let area = 0;

      while (queue.length > 0) {
        const [cx, cy] = queue.shift()!;
        area++;

        minX = Math.min(minX, cx);
        maxX = Math.max(maxX, cx);
        minY = Math.min(minY, cy);
        maxY = Math.max(maxY, cy);

        const neighbors: [number, number][] = [
          [cx - 1, cy], [cx + 1, cy], [cx, cy - 1], [cx, cy + 1]
        ];

        for (const [nx, ny] of neighbors) {
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          const nidx = ny * width + nx;
          if (mask[nidx] > 0 && !visited[nidx]) {
            visited[nidx] = 1;
            queue.push([nx, ny]);
          }
        }
      }

      const w = maxX - minX + 1;
      const h = maxY - minY + 1;
      contours.push({
        x: minX, y: minY, w, h,
        cx: minX + w / 2,
        cy: minY + h / 2,
        area
      });
    }
  }

  return contours;
}

function rotateImage(img: ImageMatrix): ImageMatrix {
  const newWidth = img.height;
  const newHeight = img.width;
  const newData = new Uint8ClampedArray(newWidth * newHeight * img.channels);

  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const srcIdx = (y * img.width + x) * img.channels;
      const newX = y;
      const newY = img.width - 1 - x;
      const dstIdx = (newY * newWidth + newX) * img.channels;

      for (let c = 0; c < img.channels; c++) {
        newData[dstIdx + c] = img.data[srcIdx + c];
      }
    }
  }

  return { data: newData, width: newWidth, height: newHeight, channels: img.channels };
}

// ============================================================================
// Constraint Parser
// ============================================================================

export class ConstraintParser {
  private wasRotated = false;
  private static readonly COLOR_CODES: ColorCode[] = ['GN', 'BL', 'CY', 'OG'];

  async parse(imageData: Uint8ClampedArray, width: number, height: number): Promise<ConstraintStripResult> {
    let img: ImageMatrix = { data: imageData, width, height, channels: 4 };

    // Detect mode before rotation
    const { isDual, mode, colors } = this.detectMode(img);

    if (colors.length === 0) {
      return { is_dual_color: false, display_mode: 'number', constraints: [], colors: [] };
    }

    // Auto-rotate vertical strips
    this.wasRotated = false;
    if (height > width * 1.5) {
      img = rotateImage(img);
      this.wasRotated = true;
    }

    // Parse based on mode
    const parseColors = isDual ? colors.slice(0, 2) : colors.slice(0, 1);
    const constraints = mode === 'bar'
      ? this.parseBars(img, parseColors)
      : await this.parseNumbers(img, parseColors);

    return {
      is_dual_color: isDual,
      display_mode: mode,
      constraints,
      colors: parseColors
    };
  }

  // ===========================================================================
  // Color and mode detection
  // ===========================================================================

  private detectMode(img: ImageMatrix): { isDual: boolean; mode: DisplayMode; colors: ColorCode[] } {
    const colors = this.detectColors(img);
    const mode = this.detectDisplayMode(img, colors);
    return { isDual: colors.length >= 2, mode, colors };
  }

  private detectColors(img: ImageMatrix): ColorCode[] {
    const totalPixels = img.width * img.height;
    const minRatio = 0.005;

    const counts: Record<ColorCode, number> = { GN: 0, BL: 0, CY: 0, OG: 0 };
    const masks: Record<ColorCode, Uint8Array> = {
      GN: createColorMask(img, 'GN'),
      BL: createColorMask(img, 'BL'),
      CY: createColorMask(img, 'CY'),
      OG: createColorMask(img, 'OG'),
    };

    for (const code of ConstraintParser.COLOR_CODES) {
      counts[code] = countMaskPixels(masks[code]);
    }

    // Disambiguate GN/CY overlap by mean hue
    if (counts.GN > 0 && counts.CY > 0) {
      let overlap = 0;
      for (let i = 0; i < masks.GN.length; i++) {
        if (masks.GN[i] > 0 && masks.CY[i] > 0) overlap++;
      }

      if (overlap > Math.min(counts.GN, counts.CY) * 0.5) {
        let hueSum = 0, hueCount = 0;
        for (let y = 0; y < img.height; y++) {
          for (let x = 0; x < img.width; x++) {
            const idx = y * img.width + x;
            if (masks.GN[idx] > 0 || masks.CY[idx] > 0) {
              const [r, g, b] = getPixel(img, x, y);
              hueSum += rgbToHsv(r, g, b).h;
              hueCount++;
            }
          }
        }

        if (hueCount > 0) {
          const meanHue = hueSum / hueCount;
          if (meanHue >= 75) counts.GN = 0;
          else counts.CY = 0;
        }
      }
    }

    const detected: ColorCode[] = [];
    for (const code of ConstraintParser.COLOR_CODES) {
      if (counts[code] / totalPixels > minRatio) {
        detected.push(code);
      }
    }

    detected.sort((a, b) => COLOR_ORDER[a] - COLOR_ORDER[b]);
    return detected;
  }

  private detectDisplayMode(img: ImageMatrix, colors: ColorCode[]): DisplayMode {
    if (colors.length === 0) return 'number';

    const mask = this.createCombinedMask(img, colors);
    const contours = findContours(mask, img.width, img.height);
    if (contours.length === 0) return 'number';

    let barCount = 0, total = 0;
    for (const cnt of contours) {
      if (cnt.area < 50) continue;
      const aspect = cnt.w / cnt.h;
      total++;
      // Bars have extreme aspect ratios
      if (aspect > 2.5 || aspect < 0.35) {
        barCount++;
      }
    }

    return total > 0 && barCount > total * 0.6 ? 'bar' : 'number';
  }

  // ===========================================================================
  // Shared utilities
  // ===========================================================================

  private createCombinedMask(img: ImageMatrix, colors: ColorCode[]): Uint8Array {
    const mask = new Uint8Array(img.width * img.height);
    for (const code of colors) {
      const colorMask = createColorMask(img, code);
      for (let i = 0; i < mask.length; i++) {
        mask[i] = mask[i] || colorMask[i];
      }
    }
    return mask;
  }

  private isValidBar(area: number, aspect: number, w: number, h: number, imgW: number, imgH: number): boolean {
    if (area < 50) return false;
    if (!(aspect > 1.2 || aspect < 0.8)) return false;
    if (aspect > 15 && w > imgW * 0.15) return false;
    if (aspect < 0.07 && h > imgH * 0.15) return false;
    return true;
  }

  private extractBars(img: ImageMatrix, colors: ColorCode[]): BarInfo[] {
    const { width, height } = img;
    const bars: BarInfo[] = [];

    for (const color of colors) {
      const mask = createColorMask(img, color);
      const contours = findContours(mask, width, height);

      for (const cnt of contours) {
        const aspect = cnt.w / cnt.h;
        if (this.isValidBar(cnt.area, aspect, cnt.w, cnt.h, width, height)) {
          bars.push({ ...cnt, color, type: 'bar' });
        }
      }
    }

    return bars;
  }

  private detectZeroSymbols(img: ImageMatrix): (Contour & { type: 'zero' })[] {
    const { width, height } = img;

    // ── Adaptive local-contrast detection ──
    // Canvas sRGB gamma makes the ∅ symbol very close in brightness to the
    // background. Instead of a fixed V threshold, we compare each pixel's
    // grayscale value against its local neighbourhood mean. Pixels that are
    // brighter than their surroundings AND have low saturation are candidates.

    // Step 1: build grayscale (V channel) and saturation arrays
    const gray = new Float32Array(width * height);
    const sat  = new Float32Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const [r, g, b] = getPixel(img, x, y);
        const hsv = rgbToHsv(r, g, b);
        const idx = y * width + x;
        gray[idx] = hsv.v;
        sat[idx]  = hsv.s;
      }
    }

    // Step 2: compute integral image for fast local mean
    const integral = new Float64Array((width + 1) * (height + 1));
    for (let y = 0; y < height; y++) {
      let rowSum = 0;
      for (let x = 0; x < width; x++) {
        rowSum += gray[y * width + x];
        integral[(y + 1) * (width + 1) + (x + 1)] =
          integral[y * (width + 1) + (x + 1)] + rowSum;
      }
    }

    const localMean = (x1: number, y1: number, x2: number, y2: number): number => {
      const iw = width + 1;
      const sum = integral[(y2 + 1) * iw + (x2 + 1)]
                - integral[y1 * iw + (x2 + 1)]
                - integral[(y2 + 1) * iw + x1]
                + integral[y1 * iw + x1];
      return sum / ((x2 - x1 + 1) * (y2 - y1 + 1));
    };

    // Step 3: adaptive threshold — pixel is "bright gray" if:
    //   V > localMean + offset  AND  S <= satMax  AND  V >= vFloor
    const R = 15;           // neighbourhood radius
    const offset = 4;       // brightness above local mean
    const satMax = 60;      // max saturation for "gray"
    const vFloor = 30;      // absolute minimum V to exclude pure black

    const grayMask = new Uint8Array(width * height);
    let grayPixelCount = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        if (sat[idx] > satMax || gray[idx] < vFloor) continue;

        const x1 = Math.max(0, x - R), y1 = Math.max(0, y - R);
        const x2 = Math.min(width - 1, x + R), y2 = Math.min(height - 1, y + R);
        const mean = localMean(x1, y1, x2, y2);

        if (gray[idx] > mean + offset) {
          grayMask[idx] = 255;
          grayPixelCount++;
        }
      }
    }

    // Step 4: morphological close (fill small gaps in ∅ outline) then open (denoise)
    const cleaned = morphCloseOpen(grayMask, width, height);

    const colorMask = this.createCombinedMask(img, ConstraintParser.COLOR_CODES);
    const contours = findContours(cleaned, width, height);
    const zeros = this.filterZeroCandidates(cleaned, contours, width, height, colorMask);

    debugLogger.info('constraint-row',
      `detectZeroSymbols(adaptive): img=${width}×${height}, grayPx=${grayPixelCount}, contours=${contours.length}, zeros=${zeros.length}`, {
        topContours: contours.filter(c => c.area >= 50).slice(0, 10).map(c => ({
          x: c.x, y: c.y, w: c.w, h: c.h, area: c.area,
          aspect: +(c.w / c.h).toFixed(2),
        })),
      });

    return zeros;
  }

  private filterZeroCandidates(
    mask: Uint8Array, contours: Contour[], width: number, height: number,
    colorMask: Uint8Array
  ): (Contour & { type: 'zero' })[] {
    const zeros: (Contour & { type: 'zero' })[] = [];

    for (const cnt of contours) {
      if (cnt.area < 100) continue;

      const aspect = cnt.w / cnt.h;
      if (aspect < 0.6 || aspect > 1.5) continue;
      if (Math.max(cnt.w, cnt.h) < height * 0.10) continue;

      // Circularity using border-pixel perimeter
      const perimeter = countBorderPixels(mask, width, height, cnt);
      if (perimeter > 0) {
        const circularity = (4 * Math.PI * cnt.area) / (perimeter * perimeter);
        if (circularity < 0.10 || circularity > 0.90) continue;
      }

      // Check no color overlap
      let colorOverlap = 0;
      for (let dy = 0; dy < cnt.h; dy++) {
        for (let dx = 0; dx < cnt.w; dx++) {
          const idx = (cnt.y + dy) * width + (cnt.x + dx);
          if (colorMask[idx] > 0) colorOverlap++;
        }
      }
      if (colorOverlap / (cnt.w * cnt.h) > 0.15) continue;

      zeros.push({ ...cnt, type: 'zero' });
    }
    return zeros;
  }

  // ===========================================================================
  // Digit extraction
  // ===========================================================================

  private extractDigitsSingle(img: ImageMatrix, color: ColorCode): { digits: Contour[]; mask: Uint8Array } {
    const { width, height } = img;

    const maskStrict = createColorMask(img, color, false);
    const maskRelaxed = createColorMask(img, color, true);

    const minDigitHeight = height * 0.15;
    const maxAspectRatio = 3.0;

    const findDigits = (mask: Uint8Array): Contour[] => {
      const contours = findContours(mask, width, height);
      const digits: Contour[] = [];

      for (const cnt of contours) {
        if (cnt.area < 100) continue;

        const maxDim = Math.max(cnt.w, cnt.h);
        const aspect = maxDim / Math.min(cnt.w, cnt.h);

        if (aspect > maxAspectRatio || maxDim < minDigitHeight) continue;
        if (cnt.y < height * 0.05 && cnt.h < height * 0.5) continue;

        // Y-position filter (key thresholds from Python)
        if (!this.wasRotated && cnt.cy < height * 0.50) continue;
        if (this.wasRotated && cnt.cy > height * 0.50) continue;

        digits.push(cnt);
      }

      return digits;
    };

    let digits = findDigits(maskStrict);
    let mask = maskStrict;

    if (digits.length === 0) {
      digits = findDigits(maskRelaxed);
      mask = maskRelaxed;
    }

    return { digits, mask };
  }

  private extractDigitsDual(img: ImageMatrix, colors: ColorCode[]): { digits: DigitInfo[]; masks: Record<ColorCode, Uint8Array> } {
    const { width, height } = img;
    const sizeBase = this.wasRotated ? Math.max(height, width) : height;
    const minSize = sizeBase * 0.03;
    const maxSize = sizeBase * 0.4;

    const digits: DigitInfo[] = [];
    const masks: Record<ColorCode, Uint8Array> = {} as Record<ColorCode, Uint8Array>;

    for (const color of colors.slice(0, 2) as ColorCode[]) {
      const countValid = (mask: Uint8Array): number => {
        const contours = findContours(mask, width, height);
        let count = 0;
        for (const cnt of contours) {
          if (cnt.area < 100) continue;
          const size = Math.max(cnt.w, cnt.h);
          if (this.wasRotated && cnt.cy > height * 0.55) continue;
          if (!this.wasRotated && cnt.cy < height * 0.45) continue;
          if (size > minSize && size < maxSize && cnt.area > 200) count++;
        }
        return count;
      };

      const maskStrict = createColorMask(img, color, false);
      const maskDim = createColorMask(img, color, true);

      const mask = countValid(maskDim) > countValid(maskStrict) ? maskDim : maskStrict;
      masks[color] = mask;

      const contours = findContours(mask, width, height);
      for (const cnt of contours) {
        if (cnt.area < 100) continue;
        const size = Math.max(cnt.w, cnt.h);

        if (this.wasRotated && cnt.cy > height * 0.55) continue;
        if (!this.wasRotated && cnt.cy < height * 0.45) continue;

        if (size > minSize && size < maxSize && cnt.area > 200) {
          digits.push({ ...cnt, color, type: 'digit' });
        }
      }
    }

    return { digits, masks };
  }

  // ===========================================================================
  // Clustering
  // ===========================================================================

  private clusterByX<T extends { cx: number }>(items: T[], _imgWidth: number): T[][] {
    if (items.length === 0) return [];
    if (items.length === 1) return [items];

    const sorted = [...items].sort((a, b) => a.cx - b.cx);
    const xs = sorted.map(d => d.cx);
    const gaps = xs.slice(1).map((x, i) => x - xs[i]);
    const significant = gaps.filter(g => g > 5);

    if (significant.length === 0) return [sorted];

    const sortedGaps = [...significant].sort((a, b) => a - b);
    const minGap = sortedGaps[0];
    const maxGap = sortedGaps[sortedGaps.length - 1];

    const threshold = maxGap > minGap * 1.3
      ? (minGap + maxGap) / 2
      : minGap * 0.8;

    const groups: T[][] = [];
    let currentGroup = [sorted[0]];

    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].cx - sorted[i - 1].cx > threshold) {
        groups.push(currentGroup);
        currentGroup = [];
      }
      currentGroup.push(sorted[i]);
    }

    if (currentGroup.length > 0) groups.push(currentGroup);
    return groups;
  }

  private clusterDualDigits(digits: DigitInfo[]): DigitInfo[][] {
    if (digits.length < 2) return digits.length > 0 ? [digits] : [];

    const sorted = [...digits].sort((a, b) => a.cx - b.cx);
    const xs = sorted.map(d => d.cx);
    const gaps = xs.slice(1).map((x, i) => x - xs[i]);
    const significant = gaps.filter(g => g > 10);

    if (significant.length === 0) return [sorted];

    const sortedGaps = [...significant].sort((a, b) => a - b);
    const minGap = sortedGaps[0];
    const maxGap = sortedGaps[sortedGaps.length - 1];

    const threshold = maxGap > minGap * 1.15
      ? (minGap + maxGap) / 2
      : minGap * 0.5;

    const groups: DigitInfo[][] = [];
    let currentGroup = [sorted[0]];

    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].cx - sorted[i - 1].cx > threshold) {
        groups.push(currentGroup);
        currentGroup = [];
      }
      currentGroup.push(sorted[i]);
    }

    if (currentGroup.length > 0) groups.push(currentGroup);
    return groups;
  }

  // ===========================================================================
  // Recognition
  // ===========================================================================

  private async recognizeDigitFromMask(mask: Uint8Array, cnt: Contour, width: number, _height: number): Promise<number> {
    // Extract ROI mask
    const roiMask = new Uint8Array(cnt.w * cnt.h);
    for (let dy = 0; dy < cnt.h; dy++) {
      for (let dx = 0; dx < cnt.w; dx++) {
        const srcIdx = (cnt.y + dy) * width + (cnt.x + dx);
        const dstIdx = dy * cnt.w + dx;
        roiMask[dstIdx] = mask[srcIdx];
      }
    }

    return recognizeDigit(roiMask, cnt.w, cnt.h, this.wasRotated);
  }

  // ===========================================================================
  // Bar parsing
  // ===========================================================================

  private parseBars(img: ImageMatrix, colors: ColorCode[]): ConstraintInfo[] {
    const { width } = img;
    const bars = this.extractBars(img, colors);
    const zeros = this.detectZeroSymbols(img);

    debugLogger.info('constraint-row', `parseBars: ${bars.length} bars, ${zeros.length} zeros, colors=${colors.join(',')}, rotated=${this.wasRotated}`);

    const allElements: Element[] = [...bars, ...zeros];
    if (allElements.length === 0) return [];

    const groups = this.clusterByX(allElements, width);
    const isDual = colors.length >= 2;

    const constraints: ConstraintInfo[] = [];
    for (const group of groups) {
      const hasZero = group.some(e => e.type === 'zero');

      if (isDual) {
        const colorCounts: Record<ColorCode, number> = { GN: 0, BL: 0, CY: 0, OG: 0 };
        for (const e of group) {
          if (e.type === 'bar' && 'color' in e) {
            colorCounts[e.color]++;
          }
        }

        const values: ConstraintValue[] = colors.slice(0, 2).map(color => ({
          color,
          value: hasZero ? 0 : colorCounts[color],
          satisfied: false
        }));
        constraints.push({ values });
      } else {
        const barCount = group.filter(e => e.type === 'bar').length;
        constraints.push({
          values: [{ color: colors[0], value: hasZero ? 0 : barCount, satisfied: false }]
        });
      }
    }

    return constraints;
  }

  // ===========================================================================
  // Number parsing
  // ===========================================================================

  private async parseNumbers(img: ImageMatrix, colors: ColorCode[]): Promise<ConstraintInfo[]> {
    const { width, height } = img;
    const isDual = colors.length >= 2;
    const zeros = this.detectZeroSymbols(img);

    if (isDual) {
      const { digits, masks } = this.extractDigitsDual(img, colors);
      const allElements: (DigitInfo | (Contour & { type: 'zero'; color: ColorCode }))[] = [
        ...digits,
        ...zeros.map(z => ({ ...z, color: colors[0] as ColorCode }))
      ];

      if (allElements.length === 0) return [];

      const groups = this.clusterDualDigits(allElements as DigitInfo[]);
      const constraints: ConstraintInfo[] = [];

      for (const group of groups) {
        const values = await this.parseDualDigitGroup(img, group, colors, masks);
        if (values.length > 0) {
          constraints.push({ values });
        }
      }

      return constraints;
    } else {
      const color = colors[0];
      const { digits, mask } = this.extractDigitsSingle(img, color);
      const allElements: (Contour & { type?: 'zero' | 'digit' })[] = [
        ...digits.map(d => ({ ...d, type: 'digit' as const })),
        ...zeros
      ];

      if (allElements.length === 0) return [];

      allElements.sort((a, b) => a.cx - b.cx);
      const constraints: ConstraintInfo[] = [];

      for (const elem of allElements) {
        if (elem.type === 'zero') {
          constraints.push({
            values: [{ color, value: 0, satisfied: false }]
          });
        } else {
          const value = await this.recognizeDigitFromMask(mask, elem, width, height);
          constraints.push({
            values: [{ color, value, satisfied: false }]
          });
        }
      }

      return constraints;
    }
  }

  private async parseDualDigitGroup(
    img: ImageMatrix,
    group: DigitInfo[],
    colors: ColorCode[],
    masks: Record<ColorCode, Uint8Array>
  ): Promise<ConstraintValue[]> {
    const colorDigits: Record<ColorCode, DigitInfo[]> = { GN: [], BL: [], CY: [], OG: [] };
    for (const d of group) {
      if (d.color in colorDigits) {
        colorDigits[d.color].push(d);
      }
    }

    const values: ConstraintValue[] = [];
    for (const color of colors.slice(0, 2) as ColorCode[]) {
      let digitsOfColor = colorDigits[color];

      // Handle zero symbols
      if (digitsOfColor.some(d => d.type === 'zero')) {
        values.push({ color, value: 0, satisfied: false });
        continue;
      }

      if (digitsOfColor.length === 0) {
        values.push({ color, value: 0, satisfied: false });
        continue;
      }

      // Keep only largest contour (filter checkmarks)
      if (digitsOfColor.length > 1) {
        const maxArea = Math.max(...digitsOfColor.map(d => d.area));
        digitsOfColor = digitsOfColor.filter(d => d.area > maxArea * 0.5);
      }

      if (digitsOfColor.length === 0) {
        values.push({ color, value: 0, satisfied: false });
        continue;
      }

      const main = digitsOfColor.reduce((a, b) => a.area > b.area ? a : b);
      const mask = masks[color];
      const value = mask ? await this.recognizeDigitFromMask(mask, main, img.width, img.height) : 0;
      values.push({ color, value, satisfied: false });
    }

    return values;
  }
}

// Singleton instance
export const constraintParser = new ConstraintParser();
