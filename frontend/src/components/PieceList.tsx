import { useState } from 'react';
import { Box, Typography, IconButton } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import type { PuzzleItem, ColorCode } from '../types/puzzle';
import { PieceEditorModal } from './PieceEditorModal';
import { useT } from '../i18n';

const COLOR_CSS: Record<ColorCode, string> = { GN: '#A5D610', BL: '#4DCCFF', CY: '#00BCD4', OG: '#FF9800' };

interface Props { pieces: PuzzleItem[]; onAdd: (item: PuzzleItem) => void; onDelete: (idx: number) => void; }

export function PieceList({ pieces, onAdd, onDelete }: Props) {
  const t = useT();
  const [hover, setHover] = useState<number | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <Box>
      <Typography variant="caption" color="text.secondary" mb={1} display="block">{t('result.piecesDetected')}</Typography>
      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5 }}>
        {pieces.map((p, idx) => (
          <Box key={idx}
            onMouseEnter={() => setHover(idx)} onMouseLeave={() => setHover(null)}
            sx={{ p: 1, bgcolor: 'action.hover', borderRadius: 1, position: 'relative', transition: 'box-shadow .15s',
              boxShadow: hover === idx ? 2 : 0,
            }}>
            {hover === idx && (
              <IconButton size="small" onClick={() => onDelete(idx)}
                sx={{ position: 'absolute', top: 2, right: 2, bgcolor: 'background.paper', width: 18, height: 18, p: 0 }}>
                <CloseIcon sx={{ fontSize: 12 }} />
              </IconButton>
            )}
            <Box display="flex" alignItems="center" gap={0.5} mb={0.5}>
              <Box sx={{ width: 10, height: 10, borderRadius: '2px', bgcolor: COLOR_CSS[p.color] }} />
              <Typography variant="caption" color="text.secondary">{t('result.piece', { n: idx + 1 })}</Typography>
            </Box>
            {p.shape.map((row, r) => (
              <Box key={r} display="flex">
                {[...row].map((ch, c) => (
                  <Box key={c} sx={{ width: 14, height: 14, border: '1px solid', borderColor: 'divider', bgcolor: ch === 'X' ? COLOR_CSS[p.color] : 'transparent' }} />
                ))}
              </Box>
            ))}
          </Box>
        ))}
        {/* Add button */}
        <Box onClick={() => setModalOpen(true)} sx={{
          p: 1, borderRadius: 1, border: '1.5px dashed', borderColor: 'text.disabled',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', minHeight: 64, '&:hover': { bgcolor: 'action.hover' },
        }}>
          <Typography color="text.disabled" fontSize={24} lineHeight={1}>+</Typography>
        </Box>
      </Box>
      <PieceEditorModal open={modalOpen} onClose={() => setModalOpen(false)} onSave={onAdd} />
    </Box>
  );
}
