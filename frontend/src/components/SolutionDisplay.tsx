import { Box, Typography } from '@mui/material';
import type { PuzzleData, PuzzleMetadata, Solution, GridCell, ColorCode, ConstraintItem } from '../types/puzzle';
import { applySolution } from '../core/solver';
import { useT } from '../i18n';

const COLOR_CSS: Record<ColorCode, string> = { GN: '#A5D610', BL: '#4DCCFF', CY: '#00BCD4', OG: '#FF9800' };

interface Props { puzzleData: PuzzleData; metadata: PuzzleMetadata; solution: Solution; }

export function SolutionDisplay({ puzzleData, metadata, solution }: Props) {
  const t = useT();
  const solved = applySolution(puzzleData, solution);
  const idMap = new Map(solution.placements.map((p, i) => [p.pieceId, i]));
  const S = 40;
  const HW = 52;

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
    <Box display="flex" flexDirection="column" alignItems="center">
      <Typography variant="subtitle2" color="primary" gutterBottom>{'✓ ' + t('result.solutionFound')}</Typography>
      <Box display="inline-block">
        {/* Column headers */}
        <Box display="flex">
          <Box width={HW} />
          {Array.from({ length: metadata.num_col }, (_, i) => (
            <Box key={i} width={S} height={S} display="flex" flexDirection="column" alignItems="center" justifyContent="center" fontSize={11} lineHeight={1.2}>
              {cfi(metadata.col_constraints, i).length === 0 && <span style={{ color: '#999', fontWeight: 700 }}>0</span>}
              {cfi(metadata.col_constraints, i).map((cc, j) => (
                <span key={j} style={{ color: COLOR_CSS[cc.color], fontWeight: 700 }}>{cc.value}</span>
              ))}
            </Box>
          ))}
        </Box>

        {/* Rows */}
        {solved.map((row, r) => (
          <Box key={r} display="flex">
            <Box width={HW} height={S} display="flex" alignItems="center" justifyContent="flex-end" pr={0.5} gap={0.3} fontSize={11}>
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
                  border: '1.5px solid', borderColor: 'divider',
                  bgcolor: bg ?? (cell.type === 'blocked' ? 'grey.300' : 'background.default'),
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 11, fontWeight: 700, color: '#fff', textShadow: '0 1px 2px rgba(0,0,0,.4)',
                }}>
                  {cell.type === 'blocked' && (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(0,0,0,0.3)" strokeWidth="2.5" strokeLinecap="round">
                      <circle cx="12" cy="12" r="9" /><line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  )}
                  {cell.type !== 'empty' && cell.type !== 'blocked' && !cell.pieceId && (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="rgba(255,255,255,0.85)" stroke="none">
                      <rect x="3" y="11" width="18" height="11" rx="2" />
                      <path d="M7 11V7a5 5 0 0 1 10 0v4" fill="none" stroke="rgba(255,255,255,0.85)" strokeWidth="2.5" strokeLinecap="round" />
                    </svg>
                  )}
                  {num}
                </Box>
              );
            })}
          </Box>
        ))}
      </Box>

      {/* Legend */}
      <Box mt={2} fontSize={13} color="text.secondary" display="flex" flexWrap="wrap" gap={1.5}>
        {solution.placements.map((p, i) => {
          const cc = metadata.puzzles[i]?.color;
          return (
            <Box key={i} display="flex" alignItems="center" gap={0.5}>
              <Box sx={{ width: 12, height: 12, borderRadius: '2px', bgcolor: cc ? COLOR_CSS[cc] : '#999' }} />
              {t('result.piece', { n: i + 1 })} {t('result.placement', { row: p.row + 1, col: p.col + 1 })}
              {p.rotationIndex > 0 && ` ↻${p.rotationIndex * 90}°`}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
