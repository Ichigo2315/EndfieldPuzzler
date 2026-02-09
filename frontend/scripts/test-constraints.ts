/**
 * Test ConstraintParser against exported ROIs and labels.
 */
import { createCanvas, loadImage, ImageData as CanvasImageData } from 'canvas';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// Polyfills
(globalThis as any).ImageData = CanvasImageData;
(globalThis as any).document = {
  createElement: (tag: string) => {
    if (tag === 'canvas') return createCanvas(1, 1);
    throw new Error(`Cannot create element: ${tag}`);
  }
};

import { ConstraintParser } from '../src/core/constraintParser.js';
import { terminateWorker } from '../src/core/digitRecognizer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DATA_DIR = path.join(__dirname, '../test_data');
const LABELS_DIR = path.join(__dirname, '../../dataset/train/puzzle_metadata');

interface Label {
  num_col: number;
  num_row: number;
  colors: string[];
  row_constraints: Array<{ index: number; color: string; value: number }>;
  col_constraints: Array<{ index: number; color: string; value: number }>;
}

async function loadImageData(imagePath: string): Promise<ImageData> {
  const image = await loadImage(imagePath);
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0);
  return ctx.getImageData(0, 0, image.width, image.height) as unknown as ImageData;
}

function loadLabel(labelPath: string): Label {
  return JSON.parse(fs.readFileSync(labelPath, 'utf-8'));
}

// Convert constraints to map for comparison
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

  // Build actual map
  const actualMap = new Map<string, number>();
  for (let idx = 0; idx < actual.length && idx < numConstraints; idx++) {
    const constraint = actual[idx];
    for (const v of constraint.values) {
      actualMap.set(`${idx},${v.color}`, v.value);
    }
  }

  // Compare
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

async function main(): Promise<void> {
  console.log('Testing ConstraintParser');
  console.log('========================\n');

  if (!fs.existsSync(TEST_DATA_DIR)) {
    console.error('Test data not found! Run vision/scripts/export_rois.py first.');
    process.exit(1);
  }

  const parser = new ConstraintParser();
  let rowPassed = 0, rowFailed = 0;
  let colPassed = 0, colFailed = 0;
  const errors: string[] = [];

  // Get all test images
  const rowImages = fs.readdirSync(TEST_DATA_DIR)
    .filter(f => f.endsWith('_row.png'))
    .sort((a, b) => parseInt(a) - parseInt(b));

  console.log(`Found ${rowImages.length} row strips to test\n`);

  for (const rowImage of rowImages) {
    const idx = rowImage.replace('_row.png', '');
    const labelPath = path.join(LABELS_DIR, `${idx}.json`);

    if (!fs.existsSync(labelPath)) {
      console.log(`[SKIP] ${idx} - no label`);
      continue;
    }

    const label = loadLabel(labelPath);

    // Test row constraints
    const rowPath = path.join(TEST_DATA_DIR, `${idx}_row.png`);
    if (fs.existsSync(rowPath)) {
      try {
        const imageData = await loadImageData(rowPath);
        const result = await parser.parse(imageData.data as Uint8ClampedArray, imageData.width, imageData.height);

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
    const colPath = path.join(TEST_DATA_DIR, `${idx}_col.png`);
    if (fs.existsSync(colPath)) {
      try {
        const imageData = await loadImageData(colPath);
        const result = await parser.parse(imageData.data as Uint8ClampedArray, imageData.width, imageData.height);

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
  console.log('\n========================');
  console.log('Summary:');
  console.log(`  Row constraints: ${rowPassed}/${rowPassed + rowFailed} passed`);
  console.log(`  Col constraints: ${colPassed}/${colPassed + colFailed} passed`);

  const total = rowPassed + colPassed;
  const totalTests = rowPassed + rowFailed + colPassed + colFailed;
  const accuracy = totalTests > 0 ? (total / totalTests * 100).toFixed(1) : 0;
  console.log(`  Overall: ${accuracy}% accuracy`);

  if (errors.length > 0) {
    console.log(`\nFailed tests (${errors.length}):`);
    errors.slice(0, 20).forEach(e => console.log(`  - ${e}`));
    if (errors.length > 20) {
      console.log(`  ... and ${errors.length - 20} more`);
    }
  }

  process.exit(errors.length > 0 ? 1 : 0);
}

main();
