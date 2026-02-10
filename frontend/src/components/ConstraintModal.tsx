import { useState, useEffect } from 'react';
import { Dialog, DialogTitle, DialogContent, DialogActions, Button, Box, TextField, Alert } from '@mui/material';
import type { ColorCode, ConstraintItem } from '../types/puzzle';
import { COLOR_CSS, ALL_COLORS } from '../core/config';
import { useT } from '../i18n';



interface Props {
  open: boolean;
  onClose: () => void;
  type: 'row' | 'col';
  index: number;
  maxValue: number;
  current: ConstraintItem[];
  onSave: (items: ConstraintItem[]) => void;
}

export function ConstraintModal({ open, onClose, type, index, maxValue, current, onSave }: Props) {
  const t = useT();
  const [vals, setVals] = useState<Record<ColorCode, number>>({ GN: 0, BL: 0, CY: 0, OG: 0 });

  useEffect(() => {
    if (!open) return;
    const v: Record<ColorCode, number> = { GN: 0, BL: 0, CY: 0, OG: 0 };
    for (const c of current) if (c.index === index) v[c.color] = c.value;
    setVals(v);
  }, [current, index, open]);

  const sum = ALL_COLORS.reduce((s, cc) => s + vals[cc], 0);
  const nonZero = ALL_COLORS.filter(cc => vals[cc] > 0).length;
  const anyOver = ALL_COLORS.some(cc => vals[cc] > maxValue);
  const sumOver = sum > maxValue;
  const tooMany = nonZero > 2;
  const hasErr = anyOver || sumOver || tooMany;
  const errMsg = anyOver ? t('editor.constraint.error.max', { max: maxValue })
    : sumOver ? t('editor.constraint.error.sum', { max: maxValue })
      : tooMany ? t('editor.constraint.error.colors') : null;

  const save = () => {
    if (hasErr) return;
    onSave(ALL_COLORS.filter(cc => vals[cc] > 0).map(cc => ({ index, color: cc, value: vals[cc] })));
  };

  const typeLabel = t(type === 'row' ? 'editor.constraint.row' : 'editor.constraint.col');

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{t('editor.constraint.title', { type: typeLabel, n: index + 1 })}</DialogTitle>
      <DialogContent sx={{ pt: '16px !important' }}>
        {ALL_COLORS.map(cc => (
          <Box key={cc} display="flex" alignItems="center" gap={2} mb={1.5}>
            <Box sx={{ width: 24, height: 24, borderRadius: '6px', bgcolor: COLOR_CSS[cc], flexShrink: 0 }} />
            <TextField
              type="number" size="small" variant="outlined"
              value={vals[cc] || ''}
              placeholder="0"
              onChange={e => {
                const n = Math.max(0, parseInt(e.target.value) || 0);
                setVals(v => ({ ...v, [cc]: n }));
              }}
              inputProps={{ min: 0, max: maxValue, style: { width: 48, textAlign: 'center' } }}
            />
          </Box>
        ))}
        {hasErr && <Alert severity="warning" sx={{ mt: 1 }}>{errMsg}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('action.cancel')}</Button>
        <Button variant="contained" disabled={hasErr} onClick={save}>{t('action.save')}</Button>
      </DialogActions>
    </Dialog>
  );
}
