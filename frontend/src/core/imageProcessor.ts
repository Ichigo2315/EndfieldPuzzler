/**
 * Top-level image processor combining all parsers.
 * Instrumented with profiler for performance monitoring.
 */
import type {
  PuzzleMetadata,
  ConstraintItem,
  PuzzleItem,
  ColorCode,
  CellCode,
  Box
} from '../types/puzzle';
import { COLOR_ORDER } from './config';
import { YOLODetector, getYOLODetector } from './yoloDetector';
import { mapParser } from './mapParser';
import { ConstraintParser } from './constraintParser';
import { pieceParser } from './pieceParser';
import { profiler } from './monitor';
import { debugLogger } from './monitor';

export class ImageProcessor {
  private detector: YOLODetector | null = null;
  private constraintParser = new ConstraintParser();

  async init(): Promise<void> {
    profiler.start('model-load');
    debugLogger.info('model-load', 'Loading YOLO ONNX model…');
    this.detector = await getYOLODetector();
    profiler.end('model-load');
    debugLogger.info('model-load', 'Model loaded');
  }

  async process(imageData: ImageData): Promise<PuzzleMetadata> {
    if (!this.detector) await this.init();

    const run = async <T>(stage: Parameters<typeof profiler.start>[0], logStage: Parameters<typeof debugLogger.info>[0], label: string, fn: () => T | Promise<T>): Promise<T> => {
      profiler.start(stage);
      try {
        const result = await fn();
        profiler.end(stage);
        return result;
      } catch (err) {
        profiler.end(stage);
        const msg = err instanceof Error ? err.message : String(err);
        const stack = err instanceof Error ? err.stack : undefined;
        debugLogger.error(logStage, `${label} FAILED: ${msg}`, { stack });
        throw err;
      }
    };

    // YOLO ROI inference
    const rois = await run('yolo-roi', 'yolo-roi', 'ROI detection', () => this.detector!.inferROIs(imageData));
    debugLogger.info('yolo-roi', 'ROI detected', {
      grid: rois.grid_bbox, row: rois.row_constraint_strip,
      col: rois.col_constraint_strip, panel: rois.piece_panel_bbox,
    });

    // YOLO Cell inference
    const cellDetections = await run('yolo-cells', 'yolo-cells', 'Cell detection', () => this.detector!.inferCells(imageData));
    debugLogger.info('yolo-cells', `Detected ${cellDetections.length} cells`);

    // Map parse
    const mapResult = await run('map-parse', 'map-parse', 'Grid map parsing', () => mapParser.parse(imageData, rois.grid_bbox, cellDetections));
    const { num_row: numRow, num_col: numCol } = mapResult;
    debugLogger.info('map-parse', `${numRow}×${numCol}`, { map: mapResult.map.map(r => JSON.stringify(r)).join(', ') });

    // Row constraint parsing
    const { constraints: rowConstraints, colors: rowColors } = await run(
      'constraint-row', 'constraint-row', 'Row constraint parsing',
      () => this.parseConstraints(imageData, rois.row_constraint_strip, numRow)
    );
    debugLogger.info('constraint-row', `${rowConstraints.length} items`, {
      data: rowConstraints.map(c => `${c.color}[${c.index}]=${c.value}`).join(', ')
    });

    // Col constraint parsing
    const { constraints: colConstraints, colors: colColors } = await run(
      'constraint-col', 'constraint-col', 'Col constraint parsing',
      () => this.parseConstraints(imageData, rois.col_constraint_strip, numCol)
    );
    debugLogger.info('constraint-col', `${colConstraints.length} items`, {
      data: colConstraints.map(c => `${c.color}[${c.index}]=${c.value}`).join(', ')
    });

    // Colors
    const mapColors = this.extractColorsFromMap(mapResult.map);
    let colors = rowColors.length > 0 ? rowColors : (colColors.length > 0 ? colColors : mapColors);

    // Piece parsing
    const puzzles = await run('piece-parse', 'piece-parse', 'Piece parsing', () => this.parsePuzzles(imageData, rois.piece_panel_bbox));
    debugLogger.info('piece-parse', `${puzzles.length} pieces`, {
      pieces: puzzles.map(p => `${p.color}:${p.shape.join('/')}`).join(' | ')
    });

    if (colors.length === 0) {
      const puzzleColors = [...new Set(puzzles.map(p => p.color))];
      colors = puzzleColors.sort((a, b) => COLOR_ORDER[a] - COLOR_ORDER[b]);
    }

    return {
      num_col: numCol, num_row: numRow, colors,
      map: mapResult.map,
      row_constraints: rowConstraints,
      col_constraints: colConstraints,
      puzzles,
    };
  }

  private async parseConstraints(
    imageData: ImageData, stripBox: Box | null, count: number
  ): Promise<{ constraints: ConstraintItem[]; colors: ColorCode[] }> {
    if (!stripBox || count === 0) return { constraints: [], colors: [] };

    const stripImageData = this.detector!.cropROI(imageData, stripBox);
    const result = await this.constraintParser.parse(
      stripImageData.data, stripImageData.width, stripImageData.height
    );

    const colors = result.colors || [];
    const items: ConstraintItem[] = [];

    for (let idx = 0; idx < Math.min(result.constraints.length, count); idx++) {
      for (const value of result.constraints[idx].values) {
        items.push({ index: idx, color: value.color, value: value.value });
      }
    }

    if (result.constraints.length < count && colors.length > 0) {
      for (let idx = result.constraints.length; idx < count; idx++) {
        for (const color of colors) {
          items.push({ index: idx, color, value: 0 });
        }
      }
    }

    return { constraints: items, colors };
  }

  private async parsePuzzles(imageData: ImageData, panelBox: Box | null): Promise<PuzzleItem[]> {
    if (!panelBox) return [];
    const panelImageData = this.detector!.cropROI(imageData, panelBox);
    const pieces = pieceParser.parse(panelImageData);
    return pieces.map(p => ({
      color: p.color,
      shape: this.coordsToShape(p.coords),
    }));
  }

  private extractColorsFromMap(gridMap: CellCode[][]): ColorCode[] {
    const colorSet = new Set<ColorCode>();
    for (const row of gridMap) {
      for (const cell of row) {
        if (cell !== 'EP' && cell !== 'BK') colorSet.add(cell as ColorCode);
      }
    }
    return [...colorSet].sort((a, b) => COLOR_ORDER[a] - COLOR_ORDER[b]);
  }

  private coordsToShape(coords: [number, number][]): string[] {
    if (coords.length === 0) return [];
    const maxX = Math.max(...coords.map(c => c[0]));
    const maxY = Math.max(...coords.map(c => c[1]));
    const grid: string[][] = Array.from({ length: maxY + 1 }, () => Array(maxX + 1).fill('O'));
    for (const [x, y] of coords) grid[y][x] = 'X';
    return grid.map(row => row.join(''));
  }
}

// ── Converter: PuzzleMetadata → PuzzleData ──
import type { PuzzleData, Piece, GridCell, Constraint } from '../types/puzzle';

/** Direct mapping — no green/blue indirection, colors stay as ColorCode */
export function metadataToPuzzleData(m: PuzzleMetadata): PuzzleData {
  const grid: GridCell[][] = m.map.map(row =>
    row.map(cell => ({ type: cell === 'EP' ? 'empty' : cell === 'BK' ? 'blocked' : cell }))
  );

  const toConstraints = (items: ConstraintItem[], count: number): Constraint[] => {
    const arr: Constraint[] = Array.from({ length: count }, () => ({}));
    for (const it of items)
      if (it.index < count) arr[it.index][it.color] = (arr[it.index][it.color] ?? 0) + it.value;
    return arr;
  };

  const pieces: Piece[] = m.puzzles.map((p, i) => ({
    id: `piece-${i}`,
    color: p.color,
    shape: p.shape.map(row => [...row].map(ch => ch === 'X')),
  }));

  return {
    gridSize: { rows: m.num_row, cols: m.num_col },
    colors: m.colors,
    grid,
    rowConstraints: toConstraints(m.row_constraints, m.num_row),
    colConstraints: toConstraints(m.col_constraints, m.num_col),
    pieces,
  };
}

// Singleton
let processorInstance: ImageProcessor | null = null;

export async function getImageProcessor(): Promise<ImageProcessor> {
  if (!processorInstance) {
    processorInstance = new ImageProcessor();
    await processorInstance.init();
  }
  return processorInstance;
}

export async function processImage(imageData: ImageData): Promise<PuzzleMetadata> {
  const processor = await getImageProcessor();
  return processor.process(imageData);
}

export function imageDataFromFile(file: File): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0);
        resolve(ctx.getImageData(0, 0, img.width, img.height));
      };
      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = e.target?.result as string;
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}
