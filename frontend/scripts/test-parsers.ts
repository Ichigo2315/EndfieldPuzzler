#!/usr/bin/env tsx
/**
 * Parser accuracy test against training dataset.
 * Compares constraint parser + piece parser output with ground truth metadata.
 *
 * Usage: npx tsx scripts/test-parsers.ts [--only constraint|piece|map] [--ids 1,2,3]
 */

// ── Node polyfills (must come before parser imports) ──
import { createCanvas, loadImage, ImageData as NodeImageData } from 'canvas';
(globalThis as any).ImageData = NodeImageData;

// Polyfill document.createElement('canvas') for pieceParser / yoloDetector
if (typeof document === 'undefined') {
  (globalThis as any).document = {
    createElement(tag: string) {
      if (tag === 'canvas') return createCanvas(1, 1);
      throw new Error(`document.createElement('${tag}') not polyfilled`);
    },
  };
}

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// Parsers
import { ConstraintParser } from '../src/core/constraintParser.js';
import { PieceParser } from '../src/core/pieceParser.js';
import { MapParser } from '../src/core/mapParser.js';
import type {
  ConstraintItem, PuzzleItem, PuzzleMetadata,
  ColorCode, CellCode, CellDetection, Box,
} from '../src/types/puzzle.js';

// ── Paths ──
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATASET = path.resolve(__dirname, '../../dataset');
const META_DIR = path.join(DATASET, 'train/puzzle_metadata');
const ROW_DIR = path.join(DATASET, 'yolo_crops_train_full/row_constraint_strip');
const COL_DIR = path.join(DATASET, 'yolo_crops_train_full/col_constraint_strip');
const PIECE_DIR = path.join(DATASET, 'yolo_crops_train_full/piece_panel_bbox');
const GRID_DIR = path.join(DATASET, 'yolo_crops_train_full/grid_bbox');
const FULL_IMG_DIR = path.join(DATASET, 'train/png_file');

// ── YOLO (Node.js via onnxruntime-node) ──
let ort: typeof import('onnxruntime-node') | null = null;
let yoloSession: any = null;
const INPUT_SIZE = 640;
const ROI_LABELS = ['grid_bbox', 'row_constraint_strip', 'col_constraint_strip', 'piece_panel_bbox'] as const;
const CELL_LABELS = ['cell_empty', 'cell_obstacle', 'cell_occupied'] as const;
const ALL_LABELS = [...ROI_LABELS, ...CELL_LABELS];

async function loadOrt() {
  if (!ort) {
    ort = await import('onnxruntime-node');
  }
  return ort;
}

async function loadYOLO() {
  if (yoloSession) return;
  const ortMod = await loadOrt();
  const modelPath = path.resolve(__dirname, '../public/models/yolo_roi.onnx');
  yoloSession = await ortMod.InferenceSession.create(modelPath, {
    executionProviders: ['cpu'],
  });
}

function preprocessForYOLO(imageData: ImageData): { tensor: any; scale: number; padX: number; padY: number } {
  const { width, height, data } = imageData;
  const scale = Math.min(INPUT_SIZE / width, INPUT_SIZE / height);
  const newW = Math.round(width * scale);
  const newH = Math.round(height * scale);
  const padX = Math.floor((INPUT_SIZE - newW) / 2);
  const padY = Math.floor((INPUT_SIZE - newH) / 2);

  const srcCanvas = createCanvas(width, height);
  const srcCtx = srcCanvas.getContext('2d');
  srcCtx.putImageData(imageData as any, 0, 0);

  const dstCanvas = createCanvas(INPUT_SIZE, INPUT_SIZE);
  const dstCtx = dstCanvas.getContext('2d');
  dstCtx.fillStyle = 'rgb(114, 114, 114)';
  dstCtx.fillRect(0, 0, INPUT_SIZE, INPUT_SIZE);
  dstCtx.drawImage(srcCanvas, 0, 0, width, height, padX, padY, newW, newH);

  const resizedData = dstCtx.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE).data;
  const tensorData = new Float32Array(3 * INPUT_SIZE * INPUT_SIZE);
  for (let i = 0; i < INPUT_SIZE * INPUT_SIZE; i++) {
    tensorData[i] = resizedData[i * 4] / 255;
    tensorData[INPUT_SIZE * INPUT_SIZE + i] = resizedData[i * 4 + 1] / 255;
    tensorData[2 * INPUT_SIZE * INPUT_SIZE + i] = resizedData[i * 4 + 2] / 255;
  }

  const ortMod = ort!;
  const tensor = new ortMod.Tensor('float32', tensorData, [1, 3, INPUT_SIZE, INPUT_SIZE]);
  return { tensor, scale, padX, padY };
}

function parseYOLOOutput(
  data: Float32Array, dims: number[], scale: number,
  padX: number, padY: number, imgW: number, imgH: number
) {
  const numClasses = ALL_LABELS.length;
  const boxes: Array<{ box: Box; classId: number; conf: number }> = [];
  const confThreshold = 0.25;

  let numBoxes: number;
  let transposed: boolean;
  if (dims.length === 3) {
    if (dims[1] === 4 + numClasses) {
      numBoxes = dims[2]; transposed = true;
    } else {
      numBoxes = dims[1]; transposed = false;
    }
  } else return boxes;

  for (let i = 0; i < numBoxes; i++) {
    let cx: number, cy: number, w: number, h: number;
    let maxConf = 0, classId = 0;
    if (transposed) {
      cx = data[0 * numBoxes + i]; cy = data[1 * numBoxes + i];
      w = data[2 * numBoxes + i]; h = data[3 * numBoxes + i];
      for (let c = 0; c < numClasses; c++) {
        const conf = data[(4 + c) * numBoxes + i];
        if (conf > maxConf) { maxConf = conf; classId = c; }
      }
    } else {
      const off = i * (4 + numClasses);
      cx = data[off]; cy = data[off + 1]; w = data[off + 2]; h = data[off + 3];
      for (let c = 0; c < numClasses; c++) {
        const conf = data[off + 4 + c];
        if (conf > maxConf) { maxConf = conf; classId = c; }
      }
    }
    if (maxConf < confThreshold) continue;
    const x1 = Math.max(0, Math.min(Math.round((cx - w / 2 - padX) / scale), imgW - 1));
    const y1 = Math.max(0, Math.min(Math.round((cy - h / 2 - padY) / scale), imgH - 1));
    const x2 = Math.max(x1 + 1, Math.min(Math.round((cx + w / 2 - padX) / scale), imgW));
    const y2 = Math.max(y1 + 1, Math.min(Math.round((cy + h / 2 - padY) / scale), imgH));
    boxes.push({ box: [x1, y1, x2, y2], classId, conf: maxConf });
  }
  return boxes;
}

async function yoloInfer(imageData: ImageData) {
  const { tensor, scale, padX, padY } = preprocessForYOLO(imageData);
  const results = await yoloSession.run({ images: tensor });
  const output = results['output0'];
  if (!output) return { rois: {} as any, cells: [] as CellDetection[] };

  const boxes = parseYOLOOutput(
    output.data as Float32Array, output.dims as number[],
    scale, padX, padY, imageData.width, imageData.height
  );

  const rois: Record<string, Box | null> = {
    grid_bbox: null, row_constraint_strip: null,
    col_constraint_strip: null, piece_panel_bbox: null,
  };
  for (const label of ROI_LABELS) {
    const classId = ALL_LABELS.indexOf(label);
    const cands = boxes.filter(b => b.classId === classId);
    if (cands.length > 0) {
      cands.sort((a, b) => b.conf - a.conf);
      rois[label] = cands[0].box;
    }
  }

  const cells: CellDetection[] = [];
  for (const label of CELL_LABELS) {
    const classId = ALL_LABELS.indexOf(label);
    for (const b of boxes) {
      if (b.classId === classId) {
        cells.push({ box: b.box, label: label as CellDetection['label'], conf: b.conf });
      }
    }
  }

  return { rois, cells };
}

function cropROI(imageData: ImageData, box: Box): ImageData {
  const [x1, y1, x2, y2] = box;
  const w = x2 - x1, h = y2 - y1;
  const src = createCanvas(imageData.width, imageData.height);
  src.getContext('2d').putImageData(imageData as any, 0, 0);
  const dst = createCanvas(w, h);
  dst.getContext('2d').drawImage(src, x1, y1, w, h, 0, 0, w, h);
  return dst.getContext('2d').getImageData(0, 0, w, h) as unknown as ImageData;
}

// ── Utilities ──

async function loadImageData(filePath: string): Promise<ImageData> {
  const img = await loadImage(filePath);
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  return ctx.getImageData(0, 0, img.width, img.height) as unknown as ImageData;
}

function loadMetadata(id: number): PuzzleMetadata {
  const p = path.join(META_DIR, `${id}.json`);
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}

function constraintsToItems(
  result: { constraints: { values: { color: ColorCode; value: number }[] }[] },
  count: number,
  colors: ColorCode[]
): ConstraintItem[] {
  const items: ConstraintItem[] = [];
  for (let idx = 0; idx < Math.min(result.constraints.length, count); idx++) {
    for (const v of result.constraints[idx].values) {
      items.push({ index: idx, color: v.color, value: v.value });
    }
  }
  if (result.constraints.length < count && colors.length > 0) {
    for (let idx = result.constraints.length; idx < count; idx++) {
      for (const c of colors) items.push({ index: idx, color: c, value: 0 });
    }
  }
  return items;
}

function coordsToShape(coords: [number, number][]): string[] {
  if (coords.length === 0) return [];
  const maxX = Math.max(...coords.map(c => c[0]));
  const maxY = Math.max(...coords.map(c => c[1]));
  const grid: string[][] = Array.from({ length: maxY + 1 }, () => Array(maxX + 1).fill('O'));
  for (const [x, y] of coords) grid[y][x] = 'X';
  return grid.map(row => row.join(''));
}

/** Normalize shape by trimming empty (O-only) rows/cols. */
function normalizeShape(shape: string[]): string[] {
  if (shape.length === 0) return [];
  // Remove bottom O-only rows
  let rows = [...shape];
  while (rows.length > 0 && rows[rows.length - 1].replace(/O/g, '') === '') rows.pop();
  while (rows.length > 0 && rows[0].replace(/O/g, '') === '') rows.shift();
  if (rows.length === 0) return [];
  // Remove right O-only cols
  const maxLen = Math.max(...rows.map(r => r.length));
  rows = rows.map(r => r.padEnd(maxLen, 'O'));
  // Remove trailing O columns
  let colEnd = maxLen;
  while (colEnd > 0 && rows.every(r => r[colEnd - 1] === 'O')) colEnd--;
  let colStart = 0;
  while (colStart < colEnd && rows.every(r => r[colStart] === 'O')) colStart++;
  return rows.map(r => r.slice(colStart, colEnd));
}

function shapeKey(shape: string[]): string {
  return normalizeShape(shape).join('|');
}

function sortItems(items: ConstraintItem[]): ConstraintItem[] {
  return [...items].sort((a, b) => a.index - b.index || a.color.localeCompare(b.color));
}

function compareConstraints(actual: ConstraintItem[], expected: ConstraintItem[]): { ok: boolean; diffs: string[] } {
  const a = sortItems(actual);
  const e = sortItems(expected);
  const diffs: string[] = [];

  if (a.length !== e.length) {
    diffs.push(`count mismatch: got ${a.length}, expected ${e.length}`);
  }

  const maxLen = Math.max(a.length, e.length);
  for (let i = 0; i < maxLen; i++) {
    const ai = a[i], ei = e[i];
    if (!ai) { diffs.push(`missing actual[${i}]: expected {idx=${ei.index}, ${ei.color}=${ei.value}}`); continue; }
    if (!ei) { diffs.push(`extra actual[${i}]: {idx=${ai.index}, ${ai.color}=${ai.value}}`); continue; }
    if (ai.index !== ei.index || ai.color !== ei.color || ai.value !== ei.value) {
      diffs.push(`[${i}] got {idx=${ai.index}, ${ai.color}=${ai.value}}, expected {idx=${ei.index}, ${ei.color}=${ei.value}}`);
    }
  }

  return { ok: diffs.length === 0, diffs };
}

function comparePieces(actual: PuzzleItem[], expected: PuzzleItem[]): { ok: boolean; diffs: string[] } {
  const diffs: string[] = [];

  if (actual.length !== expected.length) {
    diffs.push(`piece count: got ${actual.length}, expected ${expected.length}`);
  }

  // Build canonical representations and try to match
  const aKeys = actual.map(p => `${p.color}:${shapeKey(p.shape)}`);
  const eKeys = expected.map(p => `${p.color}:${shapeKey(p.shape)}`);

  const aUsed = new Set<number>();
  const eUsed = new Set<number>();

  // Exact matches
  for (let i = 0; i < eKeys.length; i++) {
    const j = aKeys.findIndex((k, idx) => k === eKeys[i] && !aUsed.has(idx));
    if (j >= 0) {
      aUsed.add(j);
      eUsed.add(i);
    }
  }

  for (let i = 0; i < expected.length; i++) {
    if (!eUsed.has(i)) {
      diffs.push(`missing piece: ${expected[i].color} ${normalizeShape(expected[i].shape).join(',')}`);
    }
  }
  for (let i = 0; i < actual.length; i++) {
    if (!aUsed.has(i)) {
      diffs.push(`extra piece: ${actual[i].color} ${normalizeShape(actual[i].shape).join(',')}`);
    }
  }

  return { ok: diffs.length === 0, diffs };
}

function compareMap(actual: CellCode[][], expected: CellCode[][]): { ok: boolean; diffs: string[] } {
  const diffs: string[] = [];
  if (actual.length !== expected.length) {
    diffs.push(`row count: got ${actual.length}, expected ${expected.length}`);
    return { ok: false, diffs };
  }
  for (let r = 0; r < expected.length; r++) {
    if (actual[r].length !== expected[r].length) {
      diffs.push(`row ${r} col count: got ${actual[r].length}, expected ${expected[r].length}`);
      continue;
    }
    for (let c = 0; c < expected[r].length; c++) {
      if (actual[r][c] !== expected[r][c]) {
        diffs.push(`cell [${r},${c}]: got ${actual[r][c]}, expected ${expected[r][c]}`);
      }
    }
  }
  return { ok: diffs.length === 0, diffs };
}

// ── Test runners ──

interface TestResult {
  id: number;
  parser: string;
  ok: boolean;
  diffs: string[];
  error?: string;
}

async function testConstraint(
  id: number,
  meta: PuzzleMetadata,
  kind: 'row' | 'col',
  parser: ConstraintParser
): Promise<TestResult> {
  const parserName = `constraint-${kind}`;
  const dir = kind === 'row' ? ROW_DIR : COL_DIR;
  const count = kind === 'row' ? meta.num_row : meta.num_col;
  const expected = kind === 'row' ? meta.row_constraints : meta.col_constraints;
  const imgPath = path.join(dir, `${id}_${kind}_constraint_strip.png`);

  if (!fs.existsSync(imgPath)) {
    return { id, parser: parserName, ok: false, diffs: [], error: `Image not found: ${imgPath}` };
  }

  try {
    const imgData = await loadImageData(imgPath);
    const result = await parser.parse(imgData.data as unknown as Uint8ClampedArray, imgData.width, imgData.height);
    const colors = result.colors.length > 0 ? result.colors : meta.colors;
    const actual = constraintsToItems(result, count, colors as ColorCode[]);
    const { ok, diffs } = compareConstraints(actual, expected);
    return { id, parser: parserName, ok, diffs };
  } catch (err) {
    return { id, parser: parserName, ok: false, diffs: [], error: String(err) };
  }
}

async function testPiece(
  id: number,
  meta: PuzzleMetadata,
  parser: PieceParser
): Promise<TestResult> {
  const imgPath = path.join(PIECE_DIR, `${id}_piece_panel_bbox.png`);
  if (!fs.existsSync(imgPath)) {
    return { id, parser: 'piece', ok: false, diffs: [], error: `Image not found: ${imgPath}` };
  }

  try {
    const imgData = await loadImageData(imgPath);
    const pieces = parser.parse(imgData as any);
    const actual: PuzzleItem[] = pieces.map(p => ({ color: p.color, shape: coordsToShape(p.coords) }));
    const { ok, diffs } = comparePieces(actual, meta.puzzles);
    return { id, parser: 'piece', ok, diffs };
  } catch (err) {
    return { id, parser: 'piece', ok: false, diffs: [], error: String(err) };
  }
}

async function testMapFull(
  id: number,
  meta: PuzzleMetadata,
  mapParser: MapParser
): Promise<TestResult> {
  const fullImgPath = path.join(FULL_IMG_DIR, `${id}.png`);
  if (!fs.existsSync(fullImgPath)) {
    return { id, parser: 'map', ok: false, diffs: [], error: `Image not found: ${fullImgPath}` };
  }

  try {
    await loadYOLO();
    const imgData = await loadImageData(fullImgPath);
    const { rois, cells } = await yoloInfer(imgData);

    if (!rois.grid_bbox) {
      return { id, parser: 'map', ok: false, diffs: ['YOLO did not detect grid_bbox'] };
    }

    const result = mapParser.parse(imgData as any, rois.grid_bbox, cells);

    const diffs: string[] = [];
    if (result.num_row !== meta.num_row) diffs.push(`num_row: got ${result.num_row}, expected ${meta.num_row}`);
    if (result.num_col !== meta.num_col) diffs.push(`num_col: got ${result.num_col}, expected ${meta.num_col}`);

    if (result.num_row === meta.num_row && result.num_col === meta.num_col) {
      const mapDiff = compareMap(result.map, meta.map);
      diffs.push(...mapDiff.diffs);
    }

    return { id, parser: 'map', ok: diffs.length === 0, diffs };
  } catch (err) {
    return { id, parser: 'map', ok: false, diffs: [], error: String(err) };
  }
}

// ── Main ──

const COLOR_RESET = '\x1b[0m';
const COLOR_GREEN = '\x1b[32m';
const COLOR_RED = '\x1b[31m';
const COLOR_YELLOW = '\x1b[33m';
const COLOR_CYAN = '\x1b[36m';
const COLOR_DIM = '\x1b[2m';

function printResult(r: TestResult) {
  const tag = r.ok ? `${COLOR_GREEN}PASS${COLOR_RESET}` : `${COLOR_RED}FAIL${COLOR_RESET}`;
  const header = `  ${tag}  #${String(r.id).padStart(2)} ${r.parser}`;
  if (r.ok) {
    console.log(header);
  } else {
    console.log(header);
    if (r.error) {
      console.log(`        ${COLOR_RED}ERROR: ${r.error}${COLOR_RESET}`);
    }
    for (const d of r.diffs) {
      console.log(`        ${COLOR_YELLOW}${d}${COLOR_RESET}`);
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  let onlyParser: string | null = null;
  let filterIds: number[] | null = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--only' && args[i + 1]) onlyParser = args[++i];
    if (args[i] === '--ids' && args[i + 1]) filterIds = args[++i].split(',').map(Number);
  }

  // Discover available IDs
  const metaFiles = fs.readdirSync(META_DIR).filter(f => /^\d+\.json$/.test(f));
  let ids = metaFiles.map(f => parseInt(f)).sort((a, b) => a - b);
  if (filterIds) ids = ids.filter(id => filterIds!.includes(id));

  console.log(`\n${COLOR_CYAN}════════════════════════════════════════════${COLOR_RESET}`);
  console.log(`${COLOR_CYAN}  Parser Accuracy Test  (${ids.length} samples)${COLOR_RESET}`);
  console.log(`${COLOR_CYAN}════════════════════════════════════════════${COLOR_RESET}\n`);

  const constraintParserInst = new ConstraintParser();
  const pieceParserInst = new PieceParser();
  const mapParserInst = new MapParser();

  const allResults: TestResult[] = [];
  const runConstraint = !onlyParser || onlyParser === 'constraint';
  const runPiece = !onlyParser || onlyParser === 'piece';
  const runMap = !onlyParser || onlyParser === 'map';

  for (const id of ids) {
    const meta = loadMetadata(id);
    console.log(`${COLOR_DIM}── Sample #${id} (${meta.num_row}×${meta.num_col}, colors=${meta.colors.join(',')}) ──${COLOR_RESET}`);

    if (runConstraint) {
      const rowResult = await testConstraint(id, meta, 'row', constraintParserInst);
      printResult(rowResult);
      allResults.push(rowResult);

      const colResult = await testConstraint(id, meta, 'col', constraintParserInst);
      printResult(colResult);
      allResults.push(colResult);
    }

    if (runPiece) {
      const pieceResult = await testPiece(id, meta, pieceParserInst);
      printResult(pieceResult);
      allResults.push(pieceResult);
    }

    if (runMap) {
      const mapResult = await testMapFull(id, meta, mapParserInst);
      printResult(mapResult);
      allResults.push(mapResult);
    }
  }

  // ── Summary ──
  console.log(`\n${COLOR_CYAN}════════════════════════════════════════════${COLOR_RESET}`);
  console.log(`${COLOR_CYAN}  Summary${COLOR_RESET}`);
  console.log(`${COLOR_CYAN}════════════════════════════════════════════${COLOR_RESET}\n`);

  const groups: Record<string, TestResult[]> = {};
  for (const r of allResults) {
    if (!groups[r.parser]) groups[r.parser] = [];
    groups[r.parser].push(r);
  }

  let allPass = true;
  for (const [parser, results] of Object.entries(groups).sort()) {
    const pass = results.filter(r => r.ok).length;
    const total = results.length;
    const pct = ((pass / total) * 100).toFixed(1);
    const color = pass === total ? COLOR_GREEN : COLOR_RED;
    console.log(`  ${color}${parser}: ${pass}/${total} (${pct}%)${COLOR_RESET}`);
    if (pass < total) {
      allPass = false;
      const failIds = results.filter(r => !r.ok).map(r => r.id);
      console.log(`    ${COLOR_YELLOW}Failed: #${failIds.join(', #')}${COLOR_RESET}`);
    }
  }

  console.log();
  if (allPass) {
    console.log(`  ${COLOR_GREEN}✓ All tests passed! 100% accuracy.${COLOR_RESET}\n`);
  } else {
    console.log(`  ${COLOR_RED}✗ Some tests failed. See details above.${COLOR_RESET}\n`);
  }

  process.exit(allPass ? 0 : 1);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(2);
});
