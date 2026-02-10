import { useState, useEffect } from 'react';
import { Dialog, DialogTitle, DialogContent, DialogActions, Button, Box, Typography } from '@mui/material';
import type { ColorCode, PuzzleItem } from '../types/puzzle';
import { COLOR_CSS, ALL_COLORS } from '../core/config';
import { useT } from '../i18n';


const S = 40;

interface Props { open: boolean; onClose: () => void; onSave: (item: PuzzleItem) => void; }

export function PieceEditorModal({ open, onClose, onSave }: Props) {
  const t = useT();
  const [color, setColor] = useState<ColorCode>('GN');
  const [cv, setCv] = useState(() => mk());
  const [painting, setPainting] = useState(false);
  const [paintVal, setPaintVal] = useState(true);

  useEffect(() => { if (open) setCv(mk()); }, [open]);

  const set = (r: number, c: number, v: boolean) =>
    setCv(g => g.map((row, ri) => ri === r ? row.map((x, ci) => ci === c ? v : x) : row));

  const down = (r: number, c: number) => { const v = !cv[r][c]; setPaintVal(v); setPainting(true); set(r, c, v); };
  const enter = (r: number, c: number) => { if (painting) set(r, c, paintVal); };
  const up = () => setPainting(false);

  const hasContent = cv.some(row => row.some(Boolean));

  const save = () => {
    let r0 = 5, r1 = -1, c0 = 5, c1 = -1;
    for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++)
      if (cv[r][c]) { r0 = Math.min(r0, r); r1 = Math.max(r1, r); c0 = Math.min(c0, c); c1 = Math.max(c1, c); }
    if (r1 < 0) return;
    const shape: string[] = [];
    for (let r = r0; r <= r1; r++) { let s = ''; for (let c = c0; c <= c1; c++) s += cv[r][c] ? 'X' : 'O'; shape.push(s); }
    onSave({ color, shape });
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ pb: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        {t('editor.piece.add')}
        <Box sx={{
          display: 'flex', gap: 0.8, p: '4px', bgcolor: 'action.hover',
          borderRadius: '10px', border: '1px solid', borderColor: 'divider'
        }}>
          {ALL_COLORS.map(cc => (
            <Box key={cc} onClick={() => setColor(cc)} sx={{
              width: 32, height: 32, borderRadius: '6px', cursor: 'pointer', bgcolor: COLOR_CSS[cc],
              outline: cc === color ? '2px solid' : '2px solid transparent',
              outlineColor: cc === color ? 'divider' : 'transparent', outlineOffset: 1.5,
              transition: 'transform 0.1s, outline-color 0.1s',
              '&:hover': { transform: 'scale(1.1)' }
            }} />
          ))}
        </Box>
      </DialogTitle>
      <DialogContent sx={{ pt: '0px !important' }}>
        <Typography variant="caption" color="text.secondary" mb={2} mt={1} display="block">
          {t('editor.piece.draw')}
        </Typography>
        <Box display="flex" justifyContent="center">
          <Box onMouseUp={up} onMouseLeave={up} sx={{ userSelect: 'none', display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {cv.map((row, r) => (
              <Box key={r} display="flex" gap="4px">
                {row.map((filled, c) => (
                  <Box key={c} onMouseDown={() => down(r, c)} onMouseEnter={() => enter(r, c)} sx={{
                    width: S, height: S, border: '2px solid', borderColor: 'divider', borderRadius: '8px',
                    bgcolor: filled ? COLOR_CSS[color] : 'background.default',
                    cursor: 'crosshair', '&:hover': { opacity: 0.7 }, transition: 'background-color .08s',
                  }} />
                ))}
              </Box>
            ))}
          </Box>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('action.cancel')}</Button>
        <Button variant="contained" disabled={!hasContent} onClick={save}>{t('action.save')}</Button>
      </DialogActions>
    </Dialog>
  );
}

function mk() { return Array.from({ length: 5 }, () => Array(5).fill(false) as boolean[]); }
