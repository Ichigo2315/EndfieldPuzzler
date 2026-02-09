/**
 * Map parser using YOLO cell detections with CV fallback.
 */
import type { Box, CellDetection, CellCode, ColorCode } from '../types/puzzle';
import { COLOR_RANGES } from './config';

export interface CellInfo {
  row: number;
  col: number;
  code: CellCode;
  source: 'yolo' | 'cv';
}

export interface MapResult {
  num_row: number;
  num_col: number;
  map: CellCode[][];
  grid_bbox: Box | null;
  cells: CellInfo[];
}

const COLOR_CODES: ColorCode[] = ['GN', 'BL', 'CY', 'OG'];

export class MapParser {
  parse(
    imageData: ImageData,
    gridBbox: Box | null,
    cellDetections: CellDetection[]
  ): MapResult {
    if (!gridBbox) {
      return { num_row: 0, num_col: 0, map: [], grid_bbox: null, cells: [] };
    }

    const { numRow, numCol } = this.estimateGridSize(cellDetections, gridBbox);
    if (numRow === 0 || numCol === 0) {
      return { num_row: 0, num_col: 0, map: [], grid_bbox: gridBbox, cells: [] };
    }

    const cellMap = this.buildCellMap(imageData, cellDetections, gridBbox, numRow, numCol);
    const map2d = this.toMapArray(cellMap, numRow, numCol);

    return {
      num_row: numRow,
      num_col: numCol,
      map: map2d,
      grid_bbox: gridBbox,
      cells: Object.values(cellMap)
    };
  }

  private estimateGridSize(cells: CellDetection[], gridBbox: Box): { numRow: number; numCol: number } {
    if (cells.length === 0) return { numRow: 0, numCol: 0 };

    const [x1, y1, x2, y2] = gridBbox;
    const gridW = x2 - x1;
    const gridH = y2 - y1;

    const centersX: number[] = [];
    const centersY: number[] = [];

    for (const cell of cells) {
      const [bx1, by1, bx2, by2] = cell.box;
      const cx = (bx1 + bx2) / 2;
      const cy = (by1 + by2) / 2;

      if (cx >= x1 && cx <= x2 && cy >= y1 && cy <= y2) {
        centersX.push(cx - x1);
        centersY.push(cy - y1);
      }
    }

    const nCells = centersX.length;
    if (nCells === 0) return { numRow: 0, numCol: 0 };

    // Try perfect square sizes
    for (let size = 3; size < 10; size++) {
      const expected = size * size;
      const tolerance = Math.max(2, expected * 0.15);

      if (Math.abs(nCells - expected) <= tolerance) {
        if (this.verifyGridSize(centersX, centersY, gridW, gridH, size, size)) {
          return { numRow: size, numCol: size };
        }
      }
    }

    return this.estimateFromSpacing(centersX, centersY, gridW, gridH, nCells);
  }

  private verifyGridSize(
    centersX: number[],
    centersY: number[],
    gridW: number,
    gridH: number,
    rows: number,
    cols: number
  ): boolean {
    const cellW = gridW / cols;
    const cellH = gridH / rows;
    const occupied = new Set<string>();

    for (let i = 0; i < centersX.length; i++) {
      const c = Math.min(Math.floor(centersX[i] / cellW), cols - 1);
      const r = Math.min(Math.floor(centersY[i] / cellH), rows - 1);
      occupied.add(`${r},${c}`);
    }

    return occupied.size >= rows * cols * 0.7;
  }

  private estimateFromSpacing(
    centersX: number[],
    centersY: number[],
    gridW: number,
    gridH: number,
    nCells: number
  ): { numRow: number; numCol: number } {
    if (nCells < 4) return { numRow: 0, numCol: 0 };

    const xs = [...centersX].sort((a, b) => a - b);
    const ys = [...centersY].sort((a, b) => a - b);

    const dx: number[] = [];
    const dy: number[] = [];

    for (let i = 0; i < xs.length - 1; i++) {
      const diff = xs[i + 1] - xs[i];
      if (diff > 5) dx.push(diff);
    }

    for (let i = 0; i < ys.length - 1; i++) {
      const diff = ys[i + 1] - ys[i];
      if (diff > 5) dy.push(diff);
    }

    if (dx.length === 0 || dy.length === 0) {
      const side = Math.round(Math.sqrt(nCells));
      return { numRow: side, numCol: side };
    }

    const medDx = dx.sort((a, b) => a - b)[Math.floor(dx.length / 2)];
    const medDy = dy.sort((a, b) => a - b)[Math.floor(dy.length / 2)];

    const cols = Math.max(3, Math.min(9, Math.round(gridW / medDx)));
    const rows = Math.max(3, Math.min(9, Math.round(gridH / medDy)));

    return { numRow: rows, numCol: cols };
  }

  private buildCellMap(
    imageData: ImageData,
    cells: CellDetection[],
    gridBbox: Box,
    numRow: number,
    numCol: number
  ): Map<string, CellInfo> {
    const [x1, y1, x2, y2] = gridBbox;
    const cellW = (x2 - x1) / numCol;
    const cellH = (y2 - y1) / numRow;
    const cellMap = new Map<string, CellInfo>();

    // Phase 1: YOLO detections
    for (const cell of cells) {
      const [bx1, by1, bx2, by2] = cell.box;
      const cx = (bx1 + bx2) / 2;
      const cy = (by1 + by2) / 2;

      if (cx < x1 || cx > x2 || cy < y1 || cy > y2) continue;

      const col = Math.min(Math.floor((cx - x1) / cellW), numCol - 1);
      const row = Math.min(Math.floor((cy - y1) / cellH), numRow - 1);
      const key = `${row},${col}`;

      let code: CellCode;
      if (cell.label === 'cell_occupied') {
        code = this.detectColor(imageData, bx1, by1, bx2, by2);
      } else if (cell.label === 'cell_obstacle') {
        code = 'BK';
      } else {
        code = 'EP';
      }

      if (!cellMap.has(key) || cell.conf > 0.5) {
        cellMap.set(key, { row, col, code, source: 'yolo' });
      }
    }

    // Phase 2: CV fallback for missing cells
    for (let r = 0; r < numRow; r++) {
      for (let c = 0; c < numCol; c++) {
        const key = `${r},${c}`;
        if (cellMap.has(key)) continue;

        const rx1 = Math.floor(x1 + c * cellW);
        const ry1 = Math.floor(y1 + r * cellH);
        const rx2 = Math.floor(rx1 + cellW);
        const ry2 = Math.floor(ry1 + cellH);

        const code = this.classifyCellCV(imageData, rx1, ry1, rx2, ry2);
        cellMap.set(key, { row: r, col: c, code, source: 'cv' });
      }
    }

    return cellMap;
  }

  private detectColor(imageData: ImageData, x1: number, y1: number, x2: number, y2: number): ColorCode {
    const counts: Record<ColorCode, number> = { GN: 0, BL: 0, CY: 0, OG: 0 };
    let gnCyPixels: { h: number }[] = [];

    for (let y = y1; y < y2; y++) {
      for (let x = x1; x < x2; x++) {
        if (x < 0 || x >= imageData.width || y < 0 || y >= imageData.height) continue;

        const idx = (y * imageData.width + x) * 4;
        const r = imageData.data[idx];
        const g = imageData.data[idx + 1];
        const b = imageData.data[idx + 2];
        const hsv = this.rgbToHsv(r, g, b);

        for (const code of COLOR_CODES) {
          const [[hMin, sMin, vMin], [hMax, sMax, vMax]] = COLOR_RANGES[code];
          if (hsv.h >= hMin && hsv.h <= hMax &&
              hsv.s >= sMin && hsv.s <= sMax &&
              hsv.v >= vMin && hsv.v <= vMax) {
            counts[code]++;

            if (code === 'GN' || code === 'CY') {
              gnCyPixels.push({ h: hsv.h });
            }
          }
        }
      }
    }

    const best = (Object.keys(counts) as ColorCode[]).reduce((a, b) =>
      counts[a] > counts[b] ? a : b
    );

    // Resolve GN/CY by mean hue
    if ((best === 'GN' || best === 'CY') && counts.GN > 0 && counts.CY > 0 && gnCyPixels.length > 0) {
      const meanHue = gnCyPixels.reduce((sum, p) => sum + p.h, 0) / gnCyPixels.length;
      return meanHue >= 75 ? 'CY' : 'GN';
    }

    return best;
  }

  private classifyCellCV(imageData: ImageData, x1: number, y1: number, x2: number, y2: number): CellCode {
    const nPixels = (x2 - x1) * (y2 - y1);
    if (nPixels === 0) return 'EP';

    const counts: Record<ColorCode, number> = { GN: 0, BL: 0, CY: 0, OG: 0 };
    let gnCyPixels: { h: number }[] = [];
    let bkCount = 0;
    let sSum = 0, vSum = 0, pixelCount = 0;

    for (let y = y1; y < y2; y++) {
      for (let x = x1; x < x2; x++) {
        if (x < 0 || x >= imageData.width || y < 0 || y >= imageData.height) continue;

        const idx = (y * imageData.width + x) * 4;
        const r = imageData.data[idx];
        const g = imageData.data[idx + 1];
        const b = imageData.data[idx + 2];
        const hsv = this.rgbToHsv(r, g, b);

        pixelCount++;
        sSum += hsv.s;
        vSum += hsv.v;

        // Check colors
        for (const code of COLOR_CODES) {
          const [[hMin, sMin, vMin], [hMax, sMax, vMax]] = COLOR_RANGES[code];
          if (hsv.h >= hMin && hsv.h <= hMax &&
              hsv.s >= sMin && hsv.s <= sMax &&
              hsv.v >= vMin && hsv.v <= vMax) {
            counts[code]++;

            if (code === 'GN' || code === 'CY') {
              gnCyPixels.push({ h: hsv.h });
            }
          }
        }

        // Check BK
        const [[bkHMin, bkSMin, bkVMin], [bkHMax, bkSMax, bkVMax]] = COLOR_RANGES.BK;
        if (hsv.h >= bkHMin && hsv.h <= bkHMax &&
            hsv.s >= bkSMin && hsv.s <= bkSMax &&
            hsv.v >= bkVMin && hsv.v <= bkVMax) {
          bkCount++;
        }
      }
    }

    const best = (Object.keys(counts) as ColorCode[]).reduce((a, b) =>
      counts[a] > counts[b] ? a : b
    );

    if (counts[best] > nPixels * 0.15) {
      if ((best === 'GN' || best === 'CY') && counts.GN > 0 && counts.CY > 0 && gnCyPixels.length > 0) {
        const meanHue = gnCyPixels.reduce((sum, p) => sum + p.h, 0) / gnCyPixels.length;
        return meanHue >= 75 ? 'CY' : 'GN';
      }
      return best;
    }

    // Check obstacle
    if (bkCount / nPixels > 0.3) return 'BK';

    // Use S/V to distinguish obstacle vs empty
    if (pixelCount > 0) {
      const meanS = sSum / pixelCount;
      const meanV = vSum / pixelCount;
      if (meanS < 15 && meanV > 40 && meanV < 100) return 'BK';
    }

    return 'EP';
  }

  private toMapArray(cellMap: Map<string, CellInfo>, numRow: number, numCol: number): CellCode[][] {
    const result: CellCode[][] = Array.from({ length: numRow }, () =>
      Array(numCol).fill('EP')
    );

    for (const [, info] of cellMap) {
      if (info.row >= 0 && info.row < numRow && info.col >= 0 && info.col < numCol) {
        result[info.row][info.col] = info.code;
      }
    }

    return result;
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
export const mapParser = new MapParser();
