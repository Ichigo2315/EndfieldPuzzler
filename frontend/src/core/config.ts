import type { ColorCode } from '../types/puzzle';

// HSV color ranges
// Format: [H_min, S_min, V_min] to [H_max, S_max, V_max]
export const COLOR_RANGES: Record<ColorCode | 'BK', [[number, number, number], [number, number, number]]> = {
  GN: [[35, 80, 80], [85, 255, 255]],
  BL: [[95, 80, 80], [135, 255, 255]],
  CY: [[80, 80, 80], [100, 255, 255]],
  OG: [[5, 120, 120], [25, 255, 255]],
  BK: [[0, 0, 40], [180, 50, 120]],
};

// Display colors (CSS hex)
export const COLOR_CSS: Record<ColorCode, string> = { GN: '#A5D610', BL: '#4DCCFF', CY: '#00BCD4', OG: '#FF9800' };

// All color codes
export const ALL_COLORS: ColorCode[] = ['GN', 'BL', 'CY', 'OG'];

// YOLO class labels
export const ROI_LABELS = ['grid_bbox', 'row_constraint_strip', 'col_constraint_strip', 'piece_panel_bbox'] as const;
export const CELL_LABELS = ['cell_empty', 'cell_obstacle', 'cell_occupied'] as const;

// Standard color order for sorting
export const COLOR_ORDER: Record<ColorCode, number> = {
  GN: 0,
  CY: 1,
  OG: 2,
  BL: 3,
};

// Model paths
export const YOLO_MODEL_PATH = '/models/yolo_roi.onnx';
