import { Box, Typography } from '@mui/material';
import type { PuzzleData, PuzzleMetadata, Solution, GridCell, ColorCode, ConstraintItem } from '../types/puzzle';
import { applySolution } from '../core/solver';
import { COLOR_CSS } from '../core/config';
import { useT } from '../i18n';



interface Props { puzzleData: PuzzleData; metadata: PuzzleMetadata; solution: Solution; }

export function SolutionDisplay({ puzzleData, metadata, solution }: Props) {
  const t = useT();
  const solved = applySolution(puzzleData, solution);
  const idMap = new Map(solution.placements.map((p, i) => [p.pieceId, i]));
  const S = 'clamp(40px, 5vh, 56px)';
  const HW = 60;

  const cfi = (items: ConstraintItem[], idx: number) => items.filter(c => c.index === idx);

  const cellBg = (cell: GridCell) => {
    if (cell.type === 'blocked') return undefined; // use grey.300 via sx
    if (cell.type === 'empty') return undefined;
    return COLOR_CSS[cell.type as ColorCode] ?? '#999';
  };

  const label = (cell: GridCell) => {
    if (!cell.pieceId) return null;
    const idx = idMap.get(cell.pieceId);
    return idx != null ? idx + 1 : null;
  };

  return (
    <Box display="flex" flexDirection="column" alignItems="center" width="100%">
      <Typography variant="h6" color="primary" gutterBottom sx={{ mb: 3, fontWeight: 700 }}>
        {'✓ ' + t('result.solutionFound')}
      </Typography>

      <Box display="flex" flexDirection="row" alignItems="flex-start" justifyContent="center" gap={4} width="100%" flexWrap="wrap">
        {/* Left: Grid container */}
        <Box sx={{ '--s': S as any }}>
          {/* Column headers */}
          <Box display="flex" sx={{ mb: '8px', gap: '4px' }}>
            <Box width={HW} sx={{ mr: '4px' }} />
            {Array.from({ length: metadata.num_col }, (_, i) => (
              <Box key={i} width={S} height={S} display="flex" flexDirection="row" alignItems="center" justifyContent="center" gap={0.5} fontSize="calc(var(--s) * 0.32)" lineHeight={1.2} sx={{
                border: '2px solid transparent', // Keep invisible border for alignment
                borderRadius: '8px'
              }}>
                {cfi(metadata.col_constraints, i).length === 0 && <span style={{ color: '#999', fontWeight: 700 }}>0</span>}
                {cfi(metadata.col_constraints, i).map((cc, j) => (
                  <span key={j} style={{ color: COLOR_CSS[cc.color], fontWeight: 700 }}>{cc.value}</span>
                ))}
              </Box>
            ))}
            {/* Symmetric spacer to keep cells centered relative to headers */}
            <Box width={HW} sx={{ ml: '4px' }} />
          </Box>

          {/* Rows with gaps */}
          <Box display="flex" flexDirection="column" gap="4px">
            {solved.map((row, r) => (
              <Box key={r} display="flex" gap="4px">
                <Box width={HW} height={S} display="flex" alignItems="center" justifyContent="flex-end" pr={1.5} gap={0.5} fontSize="calc(var(--s) * 0.32)" sx={{ mr: '4px' }}>
                  {cfi(metadata.row_constraints, r).map((cc, j) => (
                    <span key={j} style={{ color: COLOR_CSS[cc.color], fontWeight: 700 }}>{cc.value}</span>
                  ))}
                  {cfi(metadata.row_constraints, r).length === 0 && <span style={{ color: '#999', fontWeight: 700 }}>0</span>}
                </Box>
                {row.map((cell, c) => {
                  const bg = cellBg(cell);
                  const num = label(cell);
                  return (
                    <Box key={c} sx={{
                      width: S, height: S, boxSizing: 'border-box',
                      border: '2px solid', borderColor: 'divider',
                      borderRadius: '8px',
                      bgcolor: bg ?? (cell.type === 'blocked' ? 'grey.300' : 'background.default'),
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 'calc(var(--s) * 0.32)', fontWeight: 700, color: '#fff', textShadow: '0 1px 2px rgba(0,0,0,.4)',
                    }}>
                      {cell.type === 'blocked' && (
                        <svg width="45%" height="45%" viewBox="0 0 24 24" fill="none" stroke="rgba(0,0,0,0.3)" strokeWidth="2.5" strokeLinecap="round">
                          <circle cx="12" cy="12" r="9" /><line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                      )}
                      {cell.type !== 'empty' && cell.type !== 'blocked' && !cell.pieceId && (
                        <svg width="40%" height="40%" viewBox="0 0 24 24" fill="rgba(255,255,255,0.85)" stroke="none">
                          <rect x="3" y="11" width="18" height="11" rx="2" />
                          <path d="M7 11V7a5 5 0 0 1 10 0v4" fill="none" stroke="rgba(255,255,255,0.85)" strokeWidth="2.5" strokeLinecap="round" />
                        </svg>
                      )}
                      {num}
                    </Box>
                  );
                })}
                {/* Symmetric spacer to keep cells centered */}
                <Box width={HW} height={S} sx={{ ml: '4px' }} />
              </Box>
            ))}
          </Box>
        </Box>

        {/* Right: Legend container (Vertical) */}
        <Box display="flex" flexDirection="column" gap={1.5} sx={{ pt: `calc(${S} + 12px)`, minWidth: 200 }}>
          {solution.placements.map((p, i) => {
            const cc = metadata.puzzles[i]?.color;
            return (
              <Box key={i} display="flex" alignItems="center" gap={1} sx={{ p: 1, borderRadius: 1, bgcolor: 'action.hover' }}>
                <Box sx={{ width: 14, height: 14, borderRadius: '3px', bgcolor: cc ? COLOR_CSS[cc] : '#999' }} />
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {t('result.piece', { n: i + 1 })}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {t('result.placement', { row: p.row + 1, col: p.col + 1 })}
                  {p.rotationIndex > 0 && ` ↻${p.rotationIndex * 90}°`}
                </Typography>
              </Box>
            );
          })}
        </Box>
      </Box>
    </Box>
  );
}
