import { useState } from 'react';
import { Box } from '@mui/material';
import type { CellCode, ColorCode, ConstraintItem } from '../types/puzzle';
import { COLOR_CSS } from '../core/config';
import { ConstraintModal } from './ConstraintModal';



export type Tool = 'select' | 'restore' | 'blocked' | 'occupied';

interface Props {
  grid: CellCode[][];
  rowC: ConstraintItem[];
  colC: ConstraintItem[];
  tool: Tool;
  occColor: ColorCode;
  onCellClick: (r: number, c: number) => void;
  onConstraintChange: (type: 'row' | 'col', idx: number, items: ConstraintItem[]) => void;
}

const S = 'clamp(36px, 5vh, 60px)';

export function PuzzleEditor({ grid, rowC, colC, tool, onCellClick, onConstraintChange }: Props) {
  const [cModal, setCModal] = useState<{ type: 'row' | 'col'; idx: number } | null>(null);
  const [hover, setHover] = useState<string | null>(null);

  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  const cfi = (items: ConstraintItem[], idx: number) => items.filter(c => c.index === idx);
  const clickable = tool !== 'select';

  return (
    <Box display="inline-block" sx={{ userSelect: 'none', '--s': S as any }}>
      {/* Column headers */}
      <Box display="flex" sx={{ mb: '8px', gap: '4px' }}>
        <Box width={S} height={S} sx={{ mr: '4px' }} />
        {Array.from({ length: cols }, (_, i) => {
          const items = cfi(colC, i);
          const empty = items.length === 0;
          return (
            <Box key={i} onClick={() => setCModal({ type: 'col', idx: i })} sx={{
              width: S, height: S, cursor: 'pointer',
              border: empty ? '2px dashed' : '2px solid',
              borderColor: empty ? 'text.disabled' : 'divider',
              borderRadius: '8px',
              display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 0.5,
              fontSize: 'calc(var(--s) * 0.32)', lineHeight: 1.2, '&:hover': { bgcolor: 'action.hover' },
            }}>
              {empty ? <span style={{ color: '#bbb', fontSize: 'calc(var(--s) * 0.45)' }}>+</span>
                : items.map((c, j) => <span key={j} style={{ color: COLOR_CSS[c.color], fontWeight: 700 }}>{c.value}</span>)}
            </Box>
          );
        })}
      </Box>

      {/* Grid container with gaps */}
      <Box display="flex" flexDirection="column" gap="4px">
        {grid.map((row, r) => (
          <Box key={r} display="flex" gap="4px">
            {/* Row header */}
            {(() => {
              const items = cfi(rowC, r);
              const empty = items.length === 0;
              return (
                <Box onClick={() => setCModal({ type: 'row', idx: r })} sx={{
                  width: S, height: S, cursor: 'pointer',
                  border: empty ? '2px dashed' : '2px solid',
                  borderColor: empty ? 'text.disabled' : 'divider',
                  borderRadius: '8px',
                  mr: '4px', // Space between header and grid
                  pr: 0.5,
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  fontSize: 'calc(var(--s) * 0.32)', lineHeight: 1.2, '&:hover': { bgcolor: 'action.hover' },
                }}>
                  {empty ? <span style={{ color: '#bbb', fontSize: 'calc(var(--s) * 0.45)' }}>+</span>
                    : items.map((c, j) => <span key={j} style={{ color: COLOR_CSS[c.color], fontWeight: 700 }}>{c.value}</span>)}
                </Box>
              );
            })()}

            {/* Cells */}
            {row.map((cell, c) => {
              const key = `${r},${c}`;
              const isOcc = cell !== 'EP' && cell !== 'BK';
              const bg = isOcc ? COLOR_CSS[cell as ColorCode] : cell === 'BK' ? undefined : undefined;
              const isHov = hover === key && clickable;
              return (
                <Box key={c}
                  onClick={() => onCellClick(r, c)}
                  onMouseEnter={() => setHover(key)} onMouseLeave={() => setHover(null)}
                  sx={{
                    width: S, height: S, boxSizing: 'border-box',
                    border: '2px solid', borderColor: isHov ? 'primary.main' : 'divider',
                    borderRadius: '8px',
                    bgcolor: bg ?? (cell === 'BK' ? 'grey.300' : 'background.default'),
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 'calc(var(--s) * 0.32)', fontWeight: 700,
                    cursor: clickable ? 'pointer' : 'default',
                    transition: 'border-color .15s, background-color .1s',
                  }}>
                  {cell === 'BK' && (
                    <svg width="45%" height="45%" viewBox="0 0 24 24" fill="none" stroke="rgba(0,0,0,0.3)" strokeWidth="2.5" strokeLinecap="round">
                      <circle cx="12" cy="12" r="9" /><line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  )}
                  {isOcc && (
                    <svg width="40%" height="40%" viewBox="0 0 24 24" fill="rgba(255,255,255,0.85)" stroke="none">
                      <rect x="3" y="11" width="18" height="11" rx="2" />
                      <path d="M7 11V7a5 5 0 0 1 10 0v4" fill="none" stroke="rgba(255,255,255,0.85)" strokeWidth="2.5" strokeLinecap="round" />
                    </svg>
                  )}
                </Box>
              );
            })}
          </Box>
        ))}
      </Box>

      {/* Constraint modal */}
      {cModal && (
        <ConstraintModal
          open onClose={() => setCModal(null)}
          type={cModal.type} index={cModal.idx}
          maxValue={cModal.type === 'row' ? cols : rows}
          current={cModal.type === 'row' ? rowC : colC}
          onSave={items => { onConstraintChange(cModal.type, cModal.idx, items); setCModal(null); }}
        />
      )}
    </Box>
  );
}
