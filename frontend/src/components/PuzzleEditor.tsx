import { useState } from 'react';
import { Box } from '@mui/material';
import type { CellCode, ColorCode, ConstraintItem } from '../types/puzzle';
import { ConstraintModal } from './ConstraintModal';

const COLOR_CSS: Record<ColorCode, string> = { GN: '#A5D610', BL: '#4DCCFF', CY: '#00BCD4', OG: '#FF9800' };

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

const S = 40;

export function PuzzleEditor({ grid, rowC, colC, tool, onCellClick, onConstraintChange }: Props) {
  const [cModal, setCModal] = useState<{ type: 'row' | 'col'; idx: number } | null>(null);
  const [hover, setHover] = useState<string | null>(null);

  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  const cfi = (items: ConstraintItem[], idx: number) => items.filter(c => c.index === idx);
  const clickable = tool !== 'select';

  return (
    <Box display="inline-block" sx={{ userSelect: 'none' }}>
      {/* Column headers */}
      <Box display="flex">
        <Box width={S} height={S} />
        {Array.from({ length: cols }, (_, i) => {
          const items = cfi(colC, i);
          const empty = items.length === 0;
          return (
            <Box key={i} onClick={() => setCModal({ type: 'col', idx: i })} sx={{
              width: S, height: S, cursor: 'pointer',
              border: empty ? '1.5px dashed' : '1.5px solid', borderColor: empty ? 'text.disabled' : 'divider',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              fontSize: 11, lineHeight: 1.2, '&:hover': { bgcolor: 'action.hover' },
            }}>
              {empty ? <span style={{ color: '#bbb', fontSize: 16 }}>+</span>
                : items.map((c, j) => <span key={j} style={{ color: COLOR_CSS[c.color], fontWeight: 700 }}>{c.value}</span>)}
            </Box>
          );
        })}
      </Box>

      {/* Rows */}
      {grid.map((row, r) => (
        <Box key={r} display="flex">
          {/* Row header — same S×S square */}
          {(() => {
            const items = cfi(rowC, r);
            const empty = items.length === 0;
            return (
              <Box onClick={() => setCModal({ type: 'row', idx: r })} sx={{
                width: S, height: S, cursor: 'pointer',
                border: empty ? '1.5px dashed' : '1.5px solid', borderColor: empty ? 'text.disabled' : 'divider',
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                fontSize: 11, lineHeight: 1.2, '&:hover': { bgcolor: 'action.hover' },
              }}>
                {empty ? <span style={{ color: '#bbb', fontSize: 16 }}>+</span>
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
                  border: '1.5px solid', borderColor: 'divider',
                  bgcolor: bg ?? (cell === 'BK' ? 'grey.300' : 'background.default'),
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: clickable ? 'pointer' : 'default',
                  opacity: isHov ? 0.65 : 1, transition: 'opacity .1s, background-color .1s',
                }}>
                {cell === 'BK' && (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(0,0,0,0.3)" strokeWidth="2.5" strokeLinecap="round">
                    <circle cx="12" cy="12" r="9" /><line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                )}
                {isOcc && (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="rgba(255,255,255,0.85)" stroke="none">
                    <rect x="3" y="11" width="18" height="11" rx="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" fill="none" stroke="rgba(255,255,255,0.85)" strokeWidth="2.5" strokeLinecap="round" />
                  </svg>
                )}
              </Box>
            );
          })}
        </Box>
      ))}

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
