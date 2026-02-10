/**
 * YOLO detector using onnxruntime-web for ROI extraction.
 */
import * as ort from 'onnxruntime-web';
import type { Box, ROIResult, CellDetection } from '../types/puzzle';
import { ROI_LABELS, CELL_LABELS, YOLO_MODEL_PATH } from './config';

// WASM backend config
ort.env.wasm.numThreads = 1;
ort.env.wasm.wasmPaths = import.meta.env.BASE_URL || '/';

const INPUT_SIZE = 640;

export class YOLODetector {
  private session: ort.InferenceSession | null = null;
  private classNames: string[] = [];

  async load(modelPath: string = YOLO_MODEL_PATH): Promise<void> {
    if (this.session) return;

    this.session = await ort.InferenceSession.create(modelPath, {
      executionProviders: ['wasm'],
    });

    // YOLO 7-class model: 4 ROI + 3 cell types
    this.classNames = [...ROI_LABELS, ...CELL_LABELS];
  }

  async inferROIs(imageData: ImageData): Promise<ROIResult> {
    if (!this.session) {
      throw new Error('Model not loaded. Call load() first.');
    }

    const { tensor, scale, padX, padY } = this.preprocess(imageData);
    const results = await this.session.run({ images: tensor });
    const output = results['output0'];

    if (!output) {
      return { grid_bbox: null, row_constraint_strip: null, col_constraint_strip: null, piece_panel_bbox: null };
    }

    const boxes = this.parseOutput(output.data as Float32Array, output.dims as number[], scale, padX, padY, imageData.width, imageData.height);

    // Find best box for each ROI label
    const rois: ROIResult = {
      grid_bbox: null,
      row_constraint_strip: null,
      col_constraint_strip: null,
      piece_panel_bbox: null,
    };

    for (const label of ROI_LABELS) {
      const classId = this.classNames.indexOf(label);
      const candidates = boxes.filter(b => b.classId === classId);
      if (candidates.length > 0) {
        candidates.sort((a, b) => b.conf - a.conf);
        rois[label] = candidates[0].box;
      }
    }

    return rois;
  }

  async inferCells(imageData: ImageData): Promise<CellDetection[]> {
    if (!this.session) {
      throw new Error('Model not loaded. Call load() first.');
    }

    const { tensor, scale, padX, padY } = this.preprocess(imageData);
    const results = await this.session.run({ images: tensor });
    const output = results['output0'];

    if (!output) return [];

    const boxes = this.parseOutput(output.data as Float32Array, output.dims as number[], scale, padX, padY, imageData.width, imageData.height);

    const cells: CellDetection[] = [];
    for (const label of CELL_LABELS) {
      const classId = this.classNames.indexOf(label);
      for (const b of boxes) {
        if (b.classId === classId) {
          cells.push({
            box: b.box,
            label: label as CellDetection['label'],
            conf: b.conf,
          });
        }
      }
    }

    return cells;
  }

  cropROI(imageData: ImageData, box: Box): ImageData {
    const [x1, y1, x2, y2] = box;
    const w = x2 - x1;
    const h = y2 - y1;

    const canvas = document.createElement('canvas');
    canvas.width = imageData.width;
    canvas.height = imageData.height;
    const ctx = canvas.getContext('2d')!;
    ctx.putImageData(imageData, 0, 0);

    const croppedCanvas = document.createElement('canvas');
    croppedCanvas.width = w;
    croppedCanvas.height = h;
    const croppedCtx = croppedCanvas.getContext('2d')!;
    croppedCtx.drawImage(canvas, x1, y1, w, h, 0, 0, w, h);

    return croppedCtx.getImageData(0, 0, w, h);
  }

  private preprocess(imageData: ImageData): { tensor: ort.Tensor; scale: number; padX: number; padY: number } {
    const { width, height } = imageData;

    // Calculate scale and padding for letterbox
    const scale = Math.min(INPUT_SIZE / width, INPUT_SIZE / height);
    const newW = Math.round(width * scale);
    const newH = Math.round(height * scale);
    const padX = Math.floor((INPUT_SIZE - newW) / 2);
    const padY = Math.floor((INPUT_SIZE - newH) / 2);

    // Resize using canvas
    const srcCanvas = document.createElement('canvas');
    srcCanvas.width = width;
    srcCanvas.height = height;
    const srcCtx = srcCanvas.getContext('2d')!;
    srcCtx.putImageData(imageData, 0, 0);

    const dstCanvas = document.createElement('canvas');
    dstCanvas.width = INPUT_SIZE;
    dstCanvas.height = INPUT_SIZE;
    const dstCtx = dstCanvas.getContext('2d')!;

    // Fill with gray (114) for letterbox
    dstCtx.fillStyle = 'rgb(114, 114, 114)';
    dstCtx.fillRect(0, 0, INPUT_SIZE, INPUT_SIZE);
    dstCtx.drawImage(srcCanvas, 0, 0, width, height, padX, padY, newW, newH);

    const resizedData = dstCtx.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE).data;

    // Convert to CHW format, normalized to [0, 1]
    const tensorData = new Float32Array(3 * INPUT_SIZE * INPUT_SIZE);
    for (let i = 0; i < INPUT_SIZE * INPUT_SIZE; i++) {
      tensorData[i] = resizedData[i * 4] / 255;                    // R
      tensorData[INPUT_SIZE * INPUT_SIZE + i] = resizedData[i * 4 + 1] / 255;  // G
      tensorData[2 * INPUT_SIZE * INPUT_SIZE + i] = resizedData[i * 4 + 2] / 255; // B
    }

    const tensor = new ort.Tensor('float32', tensorData, [1, 3, INPUT_SIZE, INPUT_SIZE]);
    return { tensor, scale, padX, padY };
  }

  private parseOutput(
    data: Float32Array,
    dims: number[],
    scale: number,
    padX: number,
    padY: number,
    imgW: number,
    imgH: number
  ): Array<{ box: Box; classId: number; conf: number }> {
    // YOLOv8 output: [1, 4+numClasses, numBoxes] or [1, numBoxes, 4+numClasses]
    const numClasses = this.classNames.length;
    const boxes: Array<{ box: Box; classId: number; conf: number }> = [];
    const confThreshold = 0.25;

    // Detect format: [1, 4+numClasses, numBoxes] vs [1, numBoxes, 4+numClasses]
    let numBoxes: number;
    let transposed: boolean;

    if (dims.length === 3) {
      if (dims[1] === 4 + numClasses) {
        // Format: [1, 4+numClasses, numBoxes]
        numBoxes = dims[2];
        transposed = true;
      } else {
        // Format: [1, numBoxes, 4+numClasses]
        numBoxes = dims[1];
        transposed = false;
      }
    } else {
      return boxes;
    }

    for (let i = 0; i < numBoxes; i++) {
      let cx: number, cy: number, w: number, h: number;
      let maxConf = 0;
      let classId = 0;

      if (transposed) {
        cx = data[0 * numBoxes + i];
        cy = data[1 * numBoxes + i];
        w = data[2 * numBoxes + i];
        h = data[3 * numBoxes + i];

        for (let c = 0; c < numClasses; c++) {
          const conf = data[(4 + c) * numBoxes + i];
          if (conf > maxConf) {
            maxConf = conf;
            classId = c;
          }
        }
      } else {
        const offset = i * (4 + numClasses);
        cx = data[offset];
        cy = data[offset + 1];
        w = data[offset + 2];
        h = data[offset + 3];

        for (let c = 0; c < numClasses; c++) {
          const conf = data[offset + 4 + c];
          if (conf > maxConf) {
            maxConf = conf;
            classId = c;
          }
        }
      }

      if (maxConf < confThreshold) continue;

      // Convert from letterboxed coordinates to original image
      const x1Raw = (cx - w / 2 - padX) / scale;
      const y1Raw = (cy - h / 2 - padY) / scale;
      const x2Raw = (cx + w / 2 - padX) / scale;
      const y2Raw = (cy + h / 2 - padY) / scale;

      // Clamp to image bounds
      const x1 = Math.max(0, Math.min(Math.round(x1Raw), imgW - 1));
      const y1 = Math.max(0, Math.min(Math.round(y1Raw), imgH - 1));
      const x2 = Math.max(x1 + 1, Math.min(Math.round(x2Raw), imgW));
      const y2 = Math.max(y1 + 1, Math.min(Math.round(y2Raw), imgH));

      boxes.push({ box: [x1, y1, x2, y2], classId, conf: maxConf });
    }

    return boxes;
  }
}

// Singleton instance
let detectorInstance: YOLODetector | null = null;

export async function getYOLODetector(): Promise<YOLODetector> {
  if (!detectorInstance) {
    detectorInstance = new YOLODetector();
    await detectorInstance.load();
  }
  return detectorInstance;
}
