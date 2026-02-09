/**
 * Compare TypeScript constraint parser against ground-truth labels.
 * Uses YOLO-cropped constraint strips from dataset/yolo_crops_train_full
 * and puzzle_metadata labels from dataset/train/puzzle_metadata.
 *
 * Run with: npx tsx test/compare.ts
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Jimp } from 'jimp';
import { createCanvas, ImageData as CanvasImageData } from 'canvas';

// Polyfills for Node.js
(globalThis as any).ImageData = CanvasImageData;
(globalThis as any).document = {
  createElement: (tag: string) => {
    if (tag === 'canvas') return createCanvas(1, 1);
    throw new Error(`Cannot create element: ${tag}`);
  }
};

import { ConstraintParser } from '../src/core/constraintParser';
import { terminateWorker } from '../src/core/digitRecognizer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PROJECT_ROOT = join(__dirname, '../..');
const CROPS_DIR = join(PROJECT_ROOT, 'dataset/yolo_crops_train_full');
const LABELS_DIR = join(PROJECT_ROOT, 'dataset/train/puzzle_metadata');

interface Label {
  num_col: number;
  num_row: number;
  colors: string[];
  row_constraints: Array<{ index: number; color: string; value: number }>;
  col_constraints: Array<{ index: number; color: string; value: number }>;
}

async function loadImageData(imagePath: string): Promise<{ data: Uint8ClampedArray; width: number; height: number }> {
  const image = await Jimp.read(imagePath);
  const width = image.width;
  const height = image.height;
  const data = new Uint8ClampedArray(image.bitmap.data);
  return { data, width, height };
}

function constraintsToMap(constraints: Array<{ index: number; color: string; value: number }>): Map<string, number> {
  const map = new Map<string, number>();
  for (const c of constraints) {
    map.set(`${c.index},${c.color}`, c.value);
  }
  return map;
}

function compareConstraints(
  expected: Map<string, number>,
  actual: Array<{ values: Array<{ color: string; value: number }> }>,
  numConstraints: number
): { match: boolean; details: string[] } {
  const details: string[] = [];
  let allMatch = true;

  const actualMap = new Map<string, number>();
  for (let idx = 0; idx < actual.length && idx < numConstraints; idx++) {
    const constraint = actual[idx];
    for (const v of constraint.values) {
      actualMap.set(`${idx},${v.color}`, v.value);
    }
  }

  for (const [key, expectedValue] of expected) {
    const actualValue = actualMap.get(key);
    if (actualValue === undefined) {
      details.push(`  Missing: ${key} (expected ${expectedValue})`);
      allMatch = false;
    } else if (actualValue !== expectedValue) {
      details.push(`  Mismatch: ${key} expected=${expectedValue} got=${actualValue}`);
      allMatch = false;
    }
  }

  return { match: allMatch, details };
}

async function main() {
  console.log('Testing ConstraintParser against ground-truth labels');
  console.log('Using: yolo_crops_train_full + puzzle_metadata');
  console.log('='.repeat(60) + '\n');

  if (!existsSync(CROPS_DIR)) {
    console.error(`Crops directory not found: ${CROPS_DIR}`);
    process.exit(1);
  }

  const parser = new ConstraintParser();
  let rowPassed = 0, rowFailed = 0;
  let colPassed = 0, colFailed = 0;
  const errors: string[] = [];

  // Get all label files
  const { readdirSync } = await import('fs');
  const labelFiles = readdirSync(LABELS_DIR)
    .filter(f => f.endsWith('.json') && f !== 'schema.json')
    .sort((a, b) => parseInt(a) - parseInt(b));

  console.log(`Found ${labelFiles.length} labels\n`);

  for (const labelFile of labelFiles) {
    const idx = labelFile.replace('.json', '');
    const label: Label = JSON.parse(readFileSync(join(LABELS_DIR, labelFile), 'utf-8'));

    // Test row constraints
    const rowPath = join(CROPS_DIR, 'row_constraint_strip', `${idx}_row_constraint_strip.png`);
    if (existsSync(rowPath)) {
      try {
        const imageData = await loadImageData(rowPath);
        const result = await parser.parse(imageData.data, imageData.width, imageData.height);

        const expectedRow = constraintsToMap(label.row_constraints);
        const { match, details } = compareConstraints(expectedRow, result.constraints, label.num_row);

        if (match) {
          console.log(`[PASS] ${idx}_row: ${result.constraints.length} constraints, mode=${result.display_mode}`);
          rowPassed++;
        } else {
          console.log(`[FAIL] ${idx}_row:`);
          details.forEach(d => console.log(d));
          rowFailed++;
          errors.push(`${idx}_row`);
        }
      } catch (e) {
        console.log(`[ERROR] ${idx}_row: ${e}`);
        rowFailed++;
        errors.push(`${idx}_row: ${e}`);
      }
    }

    // Test col constraints
    const colPath = join(CROPS_DIR, 'col_constraint_strip', `${idx}_col_constraint_strip.png`);
    if (existsSync(colPath)) {
      try {
        const imageData = await loadImageData(colPath);
        const result = await parser.parse(imageData.data, imageData.width, imageData.height);

        const expectedCol = constraintsToMap(label.col_constraints);
        const { match, details } = compareConstraints(expectedCol, result.constraints, label.num_col);

        if (match) {
          console.log(`[PASS] ${idx}_col: ${result.constraints.length} constraints, mode=${result.display_mode}`);
          colPassed++;
        } else {
          console.log(`[FAIL] ${idx}_col:`);
          details.forEach(d => console.log(d));
          colFailed++;
          errors.push(`${idx}_col`);
        }
      } catch (e) {
        console.log(`[ERROR] ${idx}_col: ${e}`);
        colFailed++;
        errors.push(`${idx}_col: ${e}`);
      }
    }
  }

  // Cleanup
  await terminateWorker();

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('Summary:');
  console.log(`  Row constraints: ${rowPassed}/${rowPassed + rowFailed} passed`);
  console.log(`  Col constraints: ${colPassed}/${colPassed + colFailed} passed`);

  const total = rowPassed + colPassed;
  const totalTests = rowPassed + rowFailed + colPassed + colFailed;
  const accuracy = totalTests > 0 ? (total / totalTests * 100).toFixed(1) : '0';
  console.log(`  Overall: ${accuracy}% accuracy`);

  if (errors.length > 0) {
    console.log(`\nFailed tests (${errors.length}):`);
    errors.slice(0, 30).forEach(e => console.log(`  - ${e}`));
    if (errors.length > 30) {
      console.log(`  ... and ${errors.length - 30} more`);
    }
  }

  process.exit(errors.length > 0 ? 1 : 0);
}

main().catch(console.error);
