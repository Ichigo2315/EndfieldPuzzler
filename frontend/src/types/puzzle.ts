// Color codes
export type ColorCode = 'GN' | 'BL' | 'CY' | 'OG';

// Cell codes: EP=empty, BK=blocked, or color code for occupied
export type CellCode = 'EP' | 'BK' | ColorCode;

// Constraint item
export interface ConstraintItem {
  index: number;
  color: ColorCode;
  value: number;
}

// Puzzle piece
export interface PuzzleItem {
  color: ColorCode;
  shape: string[];  // ["XX", "XO"] format
}

// Complete puzzle metadata
export interface PuzzleMetadata {
  num_col: number;
  num_row: number;
  colors: ColorCode[];
  map: CellCode[][];
  row_constraints: ConstraintItem[];
  col_constraints: ConstraintItem[];
  puzzles: PuzzleItem[];
}

// Bounding box [x1, y1, x2, y2]
export type Box = [number, number, number, number];

// ROI detection result
export interface ROIResult {
  grid_bbox: Box | null;
  row_constraint_strip: Box | null;
  col_constraint_strip: Box | null;
  piece_panel_bbox: Box | null;
}

// Cell detection result
export interface CellDetection {
  box: Box;
  label: 'cell_empty' | 'cell_obstacle' | 'cell_occupied';
  conf: number;
}

// Constraint parsing result
export interface ConstraintValue {
  color: ColorCode;
  value: number;
  satisfied: boolean;
}

export interface ConstraintInfo {
  values: ConstraintValue[];
}

export type DisplayMode = 'number' | 'bar';

export interface ConstraintStripResult {
  is_dual_color: boolean;
  display_mode: DisplayMode;
  constraints: ConstraintInfo[];
  colors: ColorCode[];
}

// Piece parsing result
export interface PieceInfo {
  color: ColorCode;
  coords: [number, number][];  // [[x, y], ...]
}

// Placement & Solution
export interface PlacedPiece {
  pieceId: string;
  row: number;
  col: number;
  rotationIndex: number;
}

export interface Solution {
  placements: PlacedPiece[];
  solvedGrid: GridCell[][];
}

// Processing status
export type ProcessingStatus =
  | 'idle'
  | 'processing'
  | 'parsed'
  | 'solving'
  | 'solved'
  | 'error';

export type AppState =
  | { status: 'idle' }
  | { status: 'processing' }
  | { status: 'solving'; puzzleData: PuzzleData }
  | { status: 'solved'; puzzleData: PuzzleData; solution: Solution }
  | { status: 'error'; error: string; puzzleData?: PuzzleData };

export interface ProcessingState {
  status: ProcessingStatus;
  error?: string;
  metadata?: PuzzleMetadata;
}

// ── Solver types (color-agnostic) ──

/** Grid cell: empty, blocked, or occupied by a specific color */
export type CellType = 'empty' | 'blocked' | ColorCode;

export interface GridCell {
  type: CellType;
  pieceId?: string;
}

export interface Piece {
  id: string;
  color: ColorCode;
  shape: boolean[][];
}

/** Per-row / per-column constraint: required count of each color */
export type Constraint = Partial<Record<ColorCode, number>>;

export interface PuzzleData {
  gridSize: { rows: number; cols: number };
  colors: ColorCode[];
  grid: GridCell[][];
  rowConstraints: Constraint[];
  colConstraints: Constraint[];
  pieces: Piece[];
}
