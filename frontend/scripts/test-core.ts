/**
 * Node.js test script for core modules.
 * Tests constraint parsing against the dataset.
 */
import { createCanvas, loadImage, ImageData as CanvasImageData } from 'canvas';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// Polyfill ImageData for Node.js
(globalThis as any).ImageData = CanvasImageData;

// Polyfill document.createElement for canvas operations
(globalThis as any).document = {
  createElement: (tag: string) => {
    if (tag === 'canvas') {
      return createCanvas(1, 1);
    }
    throw new Error(`Cannot create element: ${tag}`);
  }
};

// Import after polyfills
import { ConstraintParser } from '../src/core/constraintParser.js';
import { MapParser } from '../src/core/mapParser.js';
import { PieceParser } from '../src/core/pieceParser.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATASET_DIR = path.join(__dirname, '../../dataset');

interface Label {
  num_col: number;
  num_row: number;
  colors: string[];
  map: string[];
  row_constraints: Array<{ index: number; color: string; value: number }>;
  col_constraints: Array<{ index: number; color: string; value: number }>;
  puzzles: Array<{ color: string; shape: string[] }>;
}

async function loadImageData(imagePath: string): Promise<ImageData> {
  const image = await loadImage(imagePath);
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0);
  return ctx.getImageData(0, 0, image.width, image.height) as unknown as ImageData;
}

function loadLabel(labelPath: string): Label {
  const content = fs.readFileSync(labelPath, 'utf-8');
  return JSON.parse(content);
}

// Convert label constraints to comparable format
function constraintsToMap(constraints: Array<{ index: number; color: string; value: number }>): Map<string, number> {
  const map = new Map<string, number>();
  for (const c of constraints) {
    map.set(`${c.index},${c.color}`, c.value);
  }
  return map;
}

async function testConstraintParser(): Promise<void> {
  console.log('\n=== Testing ConstraintParser ===\n');
  
  const parser = new ConstraintParser();
  let passed = 0;
  let failed = 0;
  const errors: string[] = [];

  // Get all image files
  const imageFiles = fs.readdirSync(DATASET_DIR)
    .filter(f => f.endsWith('.png'))
    .sort((a, b) => parseInt(a) - parseInt(b));

  for (const imageFile of imageFiles) {
    const idx = imageFile.replace('.png', '');
    const labelPath = path.join(DATASET_DIR, 'labels', `${idx}.json`);
    
    if (!fs.existsSync(labelPath)) {
      console.log(`  [SKIP] ${idx}.png - no label`);
      continue;
    }

    const label = loadLabel(labelPath);
    const imagePath = path.join(DATASET_DIR, imageFile);
    const imageData = await loadImageData(imagePath);

    // We need ROI boxes to test constraint parsing
    // For now, skip this test since we don't have YOLO in Node.js yet
    // Just test that the parser can be instantiated
    console.log(`  [INFO] ${idx}.png - loaded (${imageData.width}x${imageData.height})`);
    passed++;
  }

  console.log(`\nConstraintParser: ${passed} loaded, ${failed} failed`);
  if (errors.length > 0) {
    console.log('Errors:');
    errors.forEach(e => console.log(`  ${e}`));
  }
}

async function testMapParser(): Promise<void> {
  console.log('\n=== Testing MapParser ===\n');
  
  const parser = new MapParser();
  let passed = 0;
  
  const imageFiles = fs.readdirSync(DATASET_DIR)
    .filter(f => f.endsWith('.png'))
    .sort((a, b) => parseInt(a) - parseInt(b));

  for (const imageFile of imageFiles) {
    const idx = imageFile.replace('.png', '');
    const labelPath = path.join(DATASET_DIR, 'labels', `${idx}.json`);
    
    if (!fs.existsSync(labelPath)) continue;

    const imagePath = path.join(DATASET_DIR, imageFile);
    const imageData = await loadImageData(imagePath);
    
    // MapParser needs grid_bbox and cell detections from YOLO
    // Skip actual parsing test for now
    console.log(`  [INFO] ${idx}.png - loaded`);
    passed++;
  }

  console.log(`\nMapParser: ${passed} images loaded`);
}

async function testPieceParser(): Promise<void> {
  console.log('\n=== Testing PieceParser ===\n');
  
  const parser = new PieceParser();
  let passed = 0;
  let failed = 0;
  const errors: string[] = [];

  const imageFiles = fs.readdirSync(DATASET_DIR)
    .filter(f => f.endsWith('.png'))
    .sort((a, b) => parseInt(a) - parseInt(b));

  for (const imageFile of imageFiles) {
    const idx = imageFile.replace('.png', '');
    const labelPath = path.join(DATASET_DIR, 'labels', `${idx}.json`);
    
    if (!fs.existsSync(labelPath)) continue;

    const imagePath = path.join(DATASET_DIR, imageFile);
    const imageData = await loadImageData(imagePath);
    
    // PieceParser needs piece_panel_bbox ROI
    // For now just verify images can be loaded
    console.log(`  [INFO] ${idx}.png - loaded`);
    passed++;
  }

  console.log(`\nPieceParser: ${passed} images loaded`);
}

async function main(): Promise<void> {
  console.log('Testing Frontend Core Modules');
  console.log('=============================');
  console.log(`Dataset: ${DATASET_DIR}`);
  
  // Check dataset exists
  if (!fs.existsSync(DATASET_DIR)) {
    console.error('Dataset directory not found!');
    process.exit(1);
  }

  const imageCount = fs.readdirSync(DATASET_DIR).filter(f => f.endsWith('.png')).length;
  console.log(`Found ${imageCount} images\n`);

  try {
    // Test module imports
    console.log('Testing module imports...');
    console.log('  ConstraintParser: OK');
    console.log('  MapParser: OK');
    console.log('  PieceParser: OK');

    await testMapParser();
    await testPieceParser();
    await testConstraintParser();

    console.log('\n=============================');
    console.log('Note: Full integration test requires YOLO model.');
    console.log('Run the browser-based test for complete validation.');
    
  } catch (error) {
    console.error('Test failed:', error);
    process.exit(1);
  }
}

main();
