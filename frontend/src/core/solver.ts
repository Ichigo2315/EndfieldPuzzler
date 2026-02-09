import type { PuzzleData, Piece, GridCell, Solution, PlacedPiece, Constraint, ColorCode, CellType } from '../types/puzzle';

// ── Shape rotation utilities ──

function generateRotations(shape: boolean[][]): boolean[][][] {
  const rotations: boolean[][][] = [shape];
  let cur = shape;
  for (let i = 0; i < 3; i++) {
    const rows = cur.length, cols = cur[0].length;
    const rot: boolean[][] = [];
    for (let c = 0; c < cols; c++) {
      const nr: boolean[] = [];
      for (let r = rows - 1; r >= 0; r--) nr.push(cur[r][c]);
      rot.push(nr);
    }
    rotations.push(rot);
    cur = rot;
  }
  return rotations;
}

function normalizeShape(shape: boolean[][]): boolean[][] {
  let minR = shape.length, maxR = -1, minC = shape[0].length, maxC = -1;
  for (let r = 0; r < shape.length; r++)
    for (let c = 0; c < shape[r].length; c++)
      if (shape[r][c]) { minR = Math.min(minR, r); maxR = Math.max(maxR, r); minC = Math.min(minC, c); maxC = Math.max(maxC, c); }
  if (maxR < 0) return [[]];
  return shape.slice(minR, maxR + 1).map(row => row.slice(minC, maxC + 1));
}

function shapesEqual(a: boolean[][], b: boolean[][]): boolean {
  if (a.length !== b.length) return false;
  for (let r = 0; r < a.length; r++) {
    if (a[r].length !== b[r].length) return false;
    for (let c = 0; c < a[r].length; c++) if (a[r][c] !== b[r][c]) return false;
  }
  return true;
}

function getUniqueRotations(piece: Piece): boolean[][][] {
  const all = generateRotations(piece.shape).map(normalizeShape);
  const uniq: boolean[][][] = [];
  for (const s of all) if (!uniq.some(e => shapesEqual(e, s))) uniq.push(s);
  return uniq;
}

// ── Grid operations ──

function canPlace(grid: GridCell[][], shape: boolean[][], sr: number, sc: number): boolean {
  for (let r = 0; r < shape.length; r++)
    for (let c = 0; c < shape[r].length; c++) {
      if (!shape[r][c]) continue;
      const gr = sr + r, gc = sc + c;
      if (gr < 0 || gr >= grid.length || gc < 0 || gc >= grid[0].length) return false;
      if (grid[gr][gc].type === 'blocked' || grid[gr][gc].pieceId) return false;
    }
  return true;
}

function placePiece(grid: GridCell[][], shape: boolean[][], sr: number, sc: number, pieceId: string, color: ColorCode): void {
  for (let r = 0; r < shape.length; r++)
    for (let c = 0; c < shape[r].length; c++)
      if (shape[r][c]) {
        const cell = grid[sr + r][sc + c];
        cell.pieceId = pieceId;
        if (cell.type === 'empty') cell.type = color;
      }
}

function removePiece(grid: GridCell[][], shape: boolean[][], sr: number, sc: number, orig: Map<string, CellType>): void {
  for (let r = 0; r < shape.length; r++)
    for (let c = 0; c < shape[r].length; c++)
      if (shape[r][c]) {
        const key = `${sr + r},${sc + c}`;
        const cell = grid[sr + r][sc + c];
        cell.pieceId = undefined;
        cell.type = orig.get(key) ?? 'empty';
      }
}

function storeTypes(grid: GridCell[][], shape: boolean[][], sr: number, sc: number): Map<string, CellType> {
  const m = new Map<string, CellType>();
  for (let r = 0; r < shape.length; r++)
    for (let c = 0; c < shape[r].length; c++)
      if (shape[r][c]) m.set(`${sr + r},${sc + c}`, grid[sr + r][sc + c].type);
  return m;
}

function cloneGrid(grid: GridCell[][]): GridCell[][] {
  return grid.map(row => row.map(cell => ({ ...cell })));
}

// ── Constraint checking (supports arbitrary colors) ──

function countRow(grid: GridCell[][], row: number): Constraint {
  const c: Constraint = {};
  for (let i = 0; i < grid[row].length; i++) {
    const t = grid[row][i].type;
    if (t !== 'empty' && t !== 'blocked') c[t as ColorCode] = (c[t as ColorCode] ?? 0) + 1;
  }
  return c;
}

function countCol(grid: GridCell[][], col: number): Constraint {
  const c: Constraint = {};
  for (let r = 0; r < grid.length; r++) {
    const t = grid[r][col].type;
    if (t !== 'empty' && t !== 'blocked') c[t as ColorCode] = (c[t as ColorCode] ?? 0) + 1;
  }
  return c;
}

/** Exact match: every color count must equal the constraint */
function checkConstraints(grid: GridCell[][], rowC: Constraint[], colC: Constraint[], colors: ColorCode[]): boolean {
  for (let r = 0; r < grid.length; r++) {
    const cnt = countRow(grid, r);
    for (const cc of colors) if ((cnt[cc] ?? 0) !== (rowC[r][cc] ?? 0)) return false;
  }
  for (let c = 0; c < grid[0].length; c++) {
    const cnt = countCol(grid, c);
    for (const cc of colors) if ((cnt[cc] ?? 0) !== (colC[c][cc] ?? 0)) return false;
  }
  return true;
}

/** Pruning: no color count exceeds its constraint */
function constraintsPossible(grid: GridCell[][], rowC: Constraint[], colC: Constraint[], colors: ColorCode[]): boolean {
  for (let r = 0; r < grid.length; r++) {
    const cnt = countRow(grid, r);
    for (const cc of colors) if ((cnt[cc] ?? 0) > (rowC[r][cc] ?? 0)) return false;
  }
  for (let c = 0; c < grid[0].length; c++) {
    const cnt = countCol(grid, c);
    for (const cc of colors) if ((cnt[cc] ?? 0) > (colC[c][cc] ?? 0)) return false;
  }
  return true;
}

// ── Main solver (backtracking + constraint pruning) ──

export function solvePuzzle(puzzleData: PuzzleData): Solution | null {
  const { grid, rowConstraints, colConstraints, pieces, colors } = puzzleData;

  const pieceRotations = new Map<string, boolean[][][]>();
  for (const p of pieces) pieceRotations.set(p.id, getUniqueRotations(p));

  const workingGrid = cloneGrid(grid);
  const placements: PlacedPiece[] = [];

  function backtrack(idx: number): boolean {
    if (idx >= pieces.length) return checkConstraints(workingGrid, rowConstraints, colConstraints, colors);

    const piece = pieces[idx];
    const rots = pieceRotations.get(piece.id)!;

    for (let ri = 0; ri < rots.length; ri++) {
      const shape = rots[ri];
      for (let row = 0; row <= workingGrid.length - shape.length; row++) {
        for (let col = 0; col <= workingGrid[0].length - shape[0].length; col++) {
          if (!canPlace(workingGrid, shape, row, col)) continue;

          const orig = storeTypes(workingGrid, shape, row, col);
          placePiece(workingGrid, shape, row, col, piece.id, piece.color);

          if (constraintsPossible(workingGrid, rowConstraints, colConstraints, colors)) {
            placements.push({ pieceId: piece.id, row, col, rotationIndex: ri });
            if (backtrack(idx + 1)) return true;
            placements.pop();
          }

          removePiece(workingGrid, shape, row, col, orig);
        }
      }
    }
    return false;
  }

  if (backtrack(0)) return { placements, solvedGrid: cloneGrid(workingGrid) };
  return null;
}

// ── Visualization helper ──

export function applySolution(puzzleData: PuzzleData, solution: Solution): GridCell[][] {
  const grid = cloneGrid(puzzleData.grid);
  const pieceMap = new Map(puzzleData.pieces.map(p => [p.id, p]));
  for (const pl of solution.placements) {
    const piece = pieceMap.get(pl.pieceId);
    if (!piece) continue;
    const shape = getUniqueRotations(piece)[pl.rotationIndex];
    placePiece(grid, shape, pl.row, pl.col, piece.id, piece.color);
  }
  return grid;
}

export { generateRotations, normalizeShape, getUniqueRotations };
