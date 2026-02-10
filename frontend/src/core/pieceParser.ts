/**
 * Piece parser using CV-based shape and color detection.
 */
import type { ColorCode, PieceInfo } from '../types/puzzle';
import { COLOR_RANGES, ALL_COLORS } from './config';

const COLOR_CODES = ALL_COLORS;

export class PieceParser {
  parse(imageData: ImageData): PieceInfo[] {
    if (imageData.width === 0 || imageData.height === 0) {
      return [];
    }

    // Try stack-based parsing (pieces separated by white rows)
    const stacks = this.splitStack(imageData);
    if (stacks.length > 0) {
      const pieces: PieceInfo[] = [];
      for (const sub of stacks) {
        const piece = this.parseSingle(sub);
        if (piece) pieces.push(piece);
      }
      return pieces;
    }

    return this.parseMulti(imageData);
  }

  private splitStack(imageData: ImageData): ImageData[] {
    const { width, height, data } = imageData;

    // Find white rows (separators)
    const rowIsWhite: boolean[] = [];
    for (let y = 0; y < height; y++) {
      let allWhite = true;
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        if (data[idx] < 250 || data[idx + 1] < 250 || data[idx + 2] < 250) {
          allWhite = false;
          break;
        }
      }
      rowIsWhite.push(allWhite);
    }

    const segments = this.findSegments(rowIsWhite.map(v => !v));
    if (segments.length <= 1) return [];

    const pieces: ImageData[] = [];
    for (const [y0, y1] of segments) {
      const sub = this.cropImageData(imageData, 0, y0, width, y1 - y0);
      const trimmed = this.trimWhite(sub);
      if (trimmed.width > 0 && trimmed.height > 0) {
        pieces.push(trimmed);
      }
    }

    return pieces;
  }

  private parseSingle(imageData: ImageData): PieceInfo | null {
    const mask = this.createColorMask(imageData);
    const nonZero = this.countNonZero(mask, imageData.width, imageData.height);
    if (nonZero === 0) return null;

    const bounds = this.boundingRect(mask, imageData.width, imageData.height);
    if (!bounds) return null;

    const { x, y, w, h } = bounds;
    const roi = this.cropImageData(imageData, x, y, w, h);
    const roiMask = this.cropMask(mask, imageData.width, x, y, w, h);

    const color = this.detectColor(roi, roiMask, w, h);
    const coords = this.discretizeShape(roiMask, w, h);

    return coords.length > 0 ? { color, coords } : null;
  }

  private parseMulti(imageData: ImageData): PieceInfo[] {
    const { width, height } = imageData;
    const mask = this.createColorMask(imageData);
    const contours = this.findContours(mask, width, height);

    const area = width * height;
    const minArea = Math.max(200, Math.floor(area * 0.002));

    type Box = [number, number, number, number]; // x1, y1, x2, y2
    const boxes: Box[] = [];

    for (const cnt of contours) {
      if (cnt.area < minArea) continue;
      if (cnt.w < 20 || cnt.h < 20) continue;
      boxes.push([cnt.x, cnt.y, cnt.x + cnt.w, cnt.y + cnt.h]);
    }

    if (boxes.length === 0) return [];

    const merged = this.mergeByYOverlap(boxes);

    const pieces: PieceInfo[] = [];
    for (const [x1, y1, x2, y2] of merged) {
      const roi = this.cropImageData(imageData, x1, y1, x2 - x1, y2 - y1);
      const roiMask = this.cropMask(mask, width, x1, y1, x2 - x1, y2 - y1);

      const color = this.detectColor(roi, roiMask, x2 - x1, y2 - y1);
      const coords = this.discretizeShape(roiMask, x2 - x1, y2 - y1);

      if (coords.length > 0) {
        pieces.push({ color, coords });
      }
    }

    return pieces;
  }

  private mergeByYOverlap(boxes: [number, number, number, number][]): [number, number, number, number][] {
    if (boxes.length === 0) return [];

    const n = boxes.length;
    const parent = Array.from({ length: n }, (_, i) => i);

    const find = (x: number): number => {
      if (parent[x] !== x) parent[x] = find(parent[x]);
      return parent[x];
    };

    const union = (a: number, b: number): void => {
      const pa = find(a);
      const pb = find(b);
      if (pa !== pb) parent[pa] = pb;
    };

    const avgW = boxes.reduce((sum, b) => sum + (b[2] - b[0]), 0) / n;

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const [x1_i, y1_i, x2_i, y2_i] = boxes[i];
        const [x1_j, y1_j, x2_j, y2_j] = boxes[j];

        const yOverlap = Math.max(0, Math.min(y2_i, y2_j) - Math.max(y1_i, y1_j));
        const h_i = y2_i - y1_i;
        const h_j = y2_j - y1_j;
        const hasYOverlap = yOverlap > 0.5 * Math.min(h_i, h_j);

        const xGap = Math.max(0, Math.max(x1_i, x1_j) - Math.min(x2_i, x2_j));
        const xClose = xGap < avgW * 0.8;

        if (hasYOverlap && xClose) {
          union(i, j);
        }
      }
    }

    const groups: Map<number, [number, number, number, number][]> = new Map();
    for (let i = 0; i < n; i++) {
      const p = find(i);
      if (!groups.has(p)) groups.set(p, []);
      groups.get(p)!.push(boxes[i]);
    }

    const merged: [number, number, number, number][] = [];
    for (const group of groups.values()) {
      const x1 = Math.min(...group.map(b => b[0]));
      const y1 = Math.min(...group.map(b => b[1]));
      const x2 = Math.max(...group.map(b => b[2]));
      const y2 = Math.max(...group.map(b => b[3]));
      merged.push([x1, y1, x2, y2]);
    }

    merged.sort((a, b) => a[1] - b[1]);
    return merged;
  }

  private createColorMask(imageData: ImageData): Uint8Array {
    const { width, height, data } = imageData;
    const mask = new Uint8Array(width * height);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];
        const hsv = this.rgbToHsv(r, g, b);

        for (const code of COLOR_CODES) {
          const [[hMin, sMin, vMin], [hMax, sMax, vMax]] = COLOR_RANGES[code];
          if (hsv.h >= hMin && hsv.h <= hMax &&
            hsv.s >= sMin && hsv.s <= sMax &&
            hsv.v >= vMin && hsv.v <= vMax) {
            mask[y * width + x] = 255;
            break;
          }
        }
      }
    }

    return mask;
  }

  private detectColor(roi: ImageData, mask: Uint8Array, w: number, h: number): ColorCode {
    const counts: Record<ColorCode, number> = { GN: 0, BL: 0, CY: 0, OG: 0 };
    const hues: number[] = [];

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (mask[y * w + x] === 0) continue;

        const idx = (y * roi.width + x) * 4;
        const r = roi.data[idx];
        const g = roi.data[idx + 1];
        const b = roi.data[idx + 2];
        const hsv = this.rgbToHsv(r, g, b);

        hues.push(hsv.h);

        for (const code of COLOR_CODES) {
          const [[hMin, sMin, vMin], [hMax, sMax, vMax]] = COLOR_RANGES[code];
          if (hsv.h >= hMin && hsv.h <= hMax &&
            hsv.s >= sMin && hsv.s <= sMax &&
            hsv.v >= vMin && hsv.v <= vMax) {
            counts[code]++;
          }
        }
      }
    }

    if (hues.length === 0) return 'GN';

    const meanHue = hues.reduce((a, b) => a + b, 0) / hues.length;
    const best = (Object.keys(counts) as ColorCode[]).reduce((a, b) =>
      counts[a] > counts[b] ? a : b
    );

    // Resolve GN/CY by mean hue
    if (best === 'GN' && counts.CY > 0 && meanHue >= 75) {
      return 'CY';
    }

    return best;
  }

  private discretizeShape(mask: Uint8Array, w: number, h: number): [number, number][] {
    if (w === 0 || h === 0) return [];

    const nonZero = this.countNonZero(mask, w, h);
    if (nonZero === 0) return [];

    const aspect = w / h;
    let best: { coords: [number, number][]; fracs: Map<string, number> } = { coords: [], fracs: new Map() };
    let bestScore = -1;

    const minNy = aspect > 2.0 ? 1 : 2;
    const minNx = aspect < 0.5 ? 1 : 2;

    for (let ny = minNy; ny < 6; ny++) {
      for (let nx = minNx; nx < 6; nx++) {
        const gridAspect = nx / ny;
        if (aspect > 1.5 && gridAspect < 0.8) continue;
        if (aspect < 0.67 && gridAspect > 1.25) continue;

        const result = this.evalGrid(mask, w, h, nx, ny);
        if (result.score > bestScore) {
          best = result;
          bestScore = result.score;
        }
      }
    }

    // Post-filter: remove weakly-filled edge cells (bounding-box artifacts).
    // A real cell should be >50% filled; edge artifacts are typically 15-50%.
    if (best.coords.length > 1) {
      // Compute median fraction of strong cells
      const allFracs = best.coords.map(([cx, cy]) => best.fracs.get(`${cx},${cy}`) ?? 0);
      const sortedFracs = [...allFracs].sort((a, b) => b - a);
      const medianFrac = sortedFracs[Math.floor(sortedFracs.length / 2)];
      // Threshold: at least 40% of median, and at least 0.4 absolute
      const minFrac = Math.max(0.4, medianFrac * 0.4);

      const filtered = best.coords.filter(([cx, cy]) => {
        const frac = best.fracs.get(`${cx},${cy}`) ?? 0;
        return frac >= minFrac;
      });
      if (filtered.length > 0) best.coords = filtered;
    }

    return this.normalizeCoords(best.coords);
  }

  private evalGrid(
    mask: Uint8Array,
    w: number,
    h: number,
    nx: number,
    ny: number,
    threshold = 0.15
  ): { coords: [number, number][]; fracs: Map<string, number>; score: number } {
    const coords: [number, number][] = [];
    const fracs = new Map<string, number>();
    let clarityScore = 0;

    for (let r = 0; r < ny; r++) {
      for (let c = 0; c < nx; c++) {
        const x0 = Math.floor(c * w / nx);
        const x1 = Math.floor((c + 1) * w / nx);
        const y0 = Math.floor(r * h / ny);
        const y1 = Math.floor((r + 1) * h / ny);

        let sum = 0;
        let count = 0;
        for (let y = y0; y < y1; y++) {
          for (let x = x0; x < x1; x++) {
            sum += mask[y * w + x];
            count++;
          }
        }

        if (count === 0) continue;
        const frac = (sum / count) / 255;

        if (frac > threshold) {
          coords.push([c, r]);
          fracs.set(`${c},${r}`, frac);
        }
        if (frac > 0.6 || frac < 0.2) {
          clarityScore += 1;
        }
      }
    }

    if (coords.length === 0) return { coords: [], fracs, score: 0 };

    const totalCells = nx * ny;
    clarityScore /= Math.max(1, totalCells);

    const hasGaps = this.hasInternalGaps(coords, nx, ny);

    const fillRatio = coords.length / totalCells;
    const fillBonus = fillRatio >= 0.3 && fillRatio <= 0.7 ? 0.3 :
      fillRatio >= 0.2 && fillRatio <= 0.8 ? 0.15 : 0;

    let sizeBonus = 0;
    if (hasGaps) {
      if (nx >= 3 && coords.length >= 4) sizeBonus = 0.15;
      if (nx >= 4 && coords.length >= 6) sizeBonus = 0.25;
    }

    const cellW = w / nx;
    const cellH = h / ny;
    const cellAspect = cellH > 0 ? cellW / cellH : 1;
    const squareness = 1 - Math.min(Math.abs(cellAspect - 1), 1) * 0.3;

    // When all cells are nearly fully filled (solid rectangle), the grid is
    // ambiguous from the mask alone. Prefer smaller grids (Occam's razor).
    const allHigh = coords.length === totalCells &&
      coords.every(([cx, cy]) => (fracs.get(`${cx},${cy}`) ?? 0) >= 0.9);
    const parsimony = allHigh ? -0.06 * coords.length : 0;

    return { coords, fracs, score: clarityScore + fillBonus + sizeBonus + squareness + parsimony };
  }

  private hasInternalGaps(coords: [number, number][], _nx: number, _ny: number): boolean {
    if (coords.length < 4) return false;

    const filled = new Set(coords.map(([x, y]) => `${x},${y}`));
    const minX = Math.min(...coords.map(c => c[0]));
    const maxX = Math.max(...coords.map(c => c[0]));
    const minY = Math.min(...coords.map(c => c[1]));
    const maxY = Math.max(...coords.map(c => c[1]));

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        if (filled.has(`${x},${y}`)) continue;

        const hasLeft = Array.from({ length: x - minX }, (_, i) => minX + i)
          .some(lx => filled.has(`${lx},${y}`));
        const hasRight = Array.from({ length: maxX - x }, (_, i) => x + 1 + i)
          .some(rx => filled.has(`${rx},${y}`));
        const hasTop = Array.from({ length: y - minY }, (_, i) => minY + i)
          .some(ty => filled.has(`${x},${ty}`));
        const hasBottom = Array.from({ length: maxY - y }, (_, i) => y + 1 + i)
          .some(by => filled.has(`${x},${by}`));

        if (hasLeft && hasRight && hasTop && hasBottom) {
          return true;
        }
      }
    }

    return false;
  }

  private normalizeCoords(coords: [number, number][]): [number, number][] {
    if (coords.length === 0) return [];

    const minX = Math.min(...coords.map(c => c[0]));
    const minY = Math.min(...coords.map(c => c[1]));

    const normalized = coords.map(([x, y]): [number, number] => [x - minX, y - minY]);
    normalized.sort((a, b) => a[1] !== b[1] ? a[1] - b[1] : a[0] - b[0]);

    return normalized;
  }

  // ===========================================================================
  // Utilities
  // ===========================================================================

  private countNonZero(mask: Uint8Array, width: number, height: number): number {
    let count = 0;
    for (let i = 0; i < width * height; i++) {
      if (mask[i] > 0) count++;
    }
    return count;
  }

  private boundingRect(mask: Uint8Array, width: number, height: number): { x: number; y: number; w: number; h: number } | null {
    let minX = width, maxX = -1, minY = height, maxY = -1;

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

    if (maxX < 0) return null;
    return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
  }

  private findContours(mask: Uint8Array, width: number, height: number): { x: number; y: number; w: number; h: number; area: number }[] {
    const visited = new Uint8Array(width * height);
    const contours: { x: number; y: number; w: number; h: number; area: number }[] = [];

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

          for (const [nx, ny] of [[cx - 1, cy], [cx + 1, cy], [cx, cy - 1], [cx, cy + 1]]) {
            if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
            const nidx = ny * width + nx;
            if (mask[nidx] > 0 && !visited[nidx]) {
              visited[nidx] = 1;
              queue.push([nx, ny]);
            }
          }
        }

        contours.push({
          x: minX,
          y: minY,
          w: maxX - minX + 1,
          h: maxY - minY + 1,
          area
        });
      }
    }

    return contours;
  }

  private findSegments(mask: boolean[]): [number, number][] {
    const segments: [number, number][] = [];
    let start: number | null = null;

    for (let i = 0; i < mask.length; i++) {
      if (mask[i] && start === null) {
        start = i;
      }
      if (!mask[i] && start !== null) {
        segments.push([start, i]);
        start = null;
      }
    }

    if (start !== null) {
      segments.push([start, mask.length]);
    }

    return segments;
  }

  private cropImageData(imageData: ImageData, x: number, y: number, w: number, h: number): ImageData {
    const canvas = document.createElement('canvas');
    canvas.width = imageData.width;
    canvas.height = imageData.height;
    const ctx = canvas.getContext('2d')!;
    ctx.putImageData(imageData, 0, 0);

    const croppedCanvas = document.createElement('canvas');
    croppedCanvas.width = w;
    croppedCanvas.height = h;
    const croppedCtx = croppedCanvas.getContext('2d')!;
    croppedCtx.drawImage(canvas, x, y, w, h, 0, 0, w, h);

    return croppedCtx.getImageData(0, 0, w, h);
  }

  private cropMask(mask: Uint8Array, srcWidth: number, x: number, y: number, w: number, h: number): Uint8Array {
    const cropped = new Uint8Array(w * h);
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        cropped[dy * w + dx] = mask[(y + dy) * srcWidth + (x + dx)];
      }
    }
    return cropped;
  }

  private trimWhite(imageData: ImageData): ImageData {
    const { width, height, data } = imageData;

    let minX = width, maxX = -1, minY = height, maxY = -1;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        if (data[idx] < 250 || data[idx + 1] < 250 || data[idx + 2] < 250) {
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
          minY = Math.min(minY, y);
          maxY = Math.max(maxY, y);
        }
      }
    }

    if (maxX < 0) return imageData;

    return this.cropImageData(imageData, minX, minY, maxX - minX + 1, maxY - minY + 1);
  }

  private rgbToHsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
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
}

// Singleton
export const pieceParser = new PieceParser();
