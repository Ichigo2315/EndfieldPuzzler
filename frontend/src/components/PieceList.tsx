import { useState, useCallback, useRef, useLayoutEffect } from 'react';
import { Box, Typography, IconButton } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import type { PuzzleItem } from '../types/puzzle';
import { COLOR_CSS } from '../core/config';
import { PieceEditorModal } from './PieceEditorModal';
import { useT } from '../i18n';

interface Props { pieces: PuzzleItem[]; onAdd: (item: PuzzleItem) => void; onDelete: (idx: number) => void; }

const FLIP_DURATION = 300; // ms — matches exit animation
const EXIT_DURATION = 300; // ms — fade + scale out

export function PieceList({ pieces, onAdd, onDelete }: Props) {
  const t = useT();
  const [hover, setHover] = useState<number | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [deleting, setDeleting] = useState<number | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const flipRef = useRef<{ rects: Map<number, DOMRect>; deletedIdx: number } | null>(null);

  // ── FLIP: after React commits the deletion, animate remaining cards ──
  useLayoutEffect(() => {
    const flip = flipRef.current;
    if (!flip) return;
    flipRef.current = null;

    const container = containerRef.current;
    if (!container) return;

    const cards = Array.from(container.querySelectorAll<HTMLElement>('.piece-card'));

    cards.forEach((card, newIdx) => {
      const oldIdx = newIdx < flip.deletedIdx ? newIdx : newIdx + 1;
      const oldRect = flip.rects.get(oldIdx);
      if (!oldRect) return;

      const newRect = card.getBoundingClientRect();
      const dx = oldRect.left - newRect.left;
      const dy = oldRect.top - newRect.top;

      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;

      card.style.transition = 'none';
      card.style.transform = `translate(${dx}px, ${dy}px)`;
    });

    void container.offsetHeight;

    cards.forEach(card => {
      card.style.transition = `transform ${FLIP_DURATION}ms ease-out`;
      card.style.transform = '';
    });

    // Cleanup inline styles after animation
    const tid = setTimeout(() => {
      cards.forEach(card => {
        card.style.transition = '';
        card.style.transform = '';
      });
    }, FLIP_DURATION + 50);

    return () => clearTimeout(tid);
  }, [pieces]);

  const handleDelete = useCallback((idx: number) => {
    const container = containerRef.current;
    if (container) {
      const cards = container.querySelectorAll<HTMLElement>('.piece-card');
      const rects = new Map<number, DOMRect>();
      cards.forEach((card, i) => rects.set(i, card.getBoundingClientRect()));
      flipRef.current = { rects, deletedIdx: idx };
    }

    setDeleting(idx);

    setTimeout(() => {
      onDelete(idx);
      setDeleting(null);
      setHover(null);
    }, EXIT_DURATION);
  }, [onDelete]);

  return (
    <Box>
      <Typography variant="caption" color="text.secondary" mb={1} display="block">{t('result.piecesDetected')}</Typography>
      <div ref={containerRef} className="flex flex-wrap gap-3 justify-between after:content-[''] after:flex-auto after:min-w-[100px]">
        {pieces.map((p, idx) => (
          <div key={idx}
            onMouseEnter={() => setHover(idx)} onMouseLeave={() => setHover(null)}
            className={`piece-card w-[100px]${deleting === idx ? ' piece-card-exit' : ''}`}
          >
            <span style={{
              position: 'absolute', top: 8, left: 8,
              fontSize: 12, fontWeight: 600, opacity: 0.45,
              lineHeight: 1, pointerEvents: 'none',
            }}>
              {idx + 1}
            </span>
            {hover === idx && deleting !== idx && (
              <IconButton size="small" onClick={(e) => { e.stopPropagation(); handleDelete(idx); }}
                sx={{ position: 'absolute', top: 4, right: 4, bgcolor: 'background.paper', width: 24, height: 24, p: 0, zIndex: 10, boxShadow: 1 }}>
                <CloseIcon sx={{ fontSize: 16 }} />
              </IconButton>
            )}

            {/* Piece Shape Visualization — auto-scaled to fit a fixed area */}
            {(() => {
              const rows = p.shape.length;
              const cols = p.shape[0]?.length ?? 0;
              const maxDim = Math.max(rows, cols, 1);
              const AREA = 64;
              const GAP = 1.5;
              const cellSize = Math.min(16, Math.floor((AREA - (maxDim - 1) * GAP) / maxDim));
              return (
                <div style={{ width: AREA, height: AREA, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: GAP }}>
                  {p.shape.map((row, r) => (
                    <div key={r} style={{ display: 'flex', gap: GAP }}>
                      {[...row].map((ch, c) => (
                        <div key={c}
                          className="rounded-[2px]"
                          style={{
                            width: cellSize,
                            height: cellSize,
                            backgroundColor: ch === 'X' ? COLOR_CSS[p.color] : 'transparent',
                            opacity: ch === 'X' ? 1 : 0.05,
                            border: ch !== 'X' ? '1px solid rgba(0,0,0,0.05)' : 'none'
                          }}
                        />
                      ))}
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>
        ))}
        <div onClick={() => setModalOpen(true)} className="piece-add-btn w-[100px] aspect-square">
          <Typography fontSize={40} fontWeight="light">+</Typography>
        </div>
      </div>
      <PieceEditorModal open={modalOpen} onClose={() => setModalOpen(false)} onSave={onAdd} />
    </Box>
  );
}
