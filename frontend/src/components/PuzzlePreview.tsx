import { Box } from '@mui/material';
import LockIcon from '@mui/icons-material/Lock';
import type { PuzzleMetadata, ColorCode, CellCode, ConstraintItem } from '../types/puzzle';

const COLOR_CSS: Record<ColorCode, string> = { GN: '#A5D610', BL: '#4DCCFF', CY: '#00BCD4', OG: '#FF9800' };

interface Props { metadata: PuzzleMetadata; }

export function PuzzlePreview({ metadata }: Props) {
  const { map, row_constraints, col_constraints, num_col } = metadata;
  const S = 36;
  const LW = 56;

  const cfi = (items: ConstraintItem[], idx: number) => items.filter(c => c.index === idx);

  return (
    <Box display="inline-block">
      <Box display="flex">
        <Box width={LW} />
        {Array.from({ length: num_col }, (_, i) => (
          <Box key={i} width={S} height={S} display="flex" flexDirection="column" alignItems="center" justifyContent="center" fontSize={11} lineHeight={1.2}>
            {cfi(col_constraints, i).length === 0 && <span style={{ color: '#999', fontWeight: 700 }}>0</span>}
            {cfi(col_constraints, i).map((c, j) => (
              <span key={j} style={{ color: COLOR_CSS[c.color], fontWeight: 700 }}>{c.value}</span>
            ))}
          </Box>
        ))}
      </Box>
      {map.map((row, r) => (
        <Box key={r} display="flex">
          <Box width={LW} height={S} display="flex" alignItems="center" justifyContent="flex-end" pr={0.5} gap={0.3} fontSize={11}>
            {cfi(row_constraints, r).map((c, j) => (
              <span key={j} style={{ color: COLOR_CSS[c.color], fontWeight: 700 }}>{c.value}</span>
            ))}
            {cfi(row_constraints, r).length === 0 && <span style={{ color: '#999', fontWeight: 700 }}>0</span>}
          </Box>
          {row.map((cell: CellCode, c: number) => {
            const isColor = cell !== 'EP' && cell !== 'BK';
            const bg = isColor ? COLOR_CSS[cell as ColorCode] : cell === 'BK' ? '#757575' : 'background.default';
            return (
              <Box key={c} sx={{
                width: S, height: S, border: '1px solid', borderColor: 'divider', bgcolor: bg,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {isColor && <LockIcon sx={{ fontSize: 14, color: 'rgba(255,255,255,0.8)' }} />}
              </Box>
            );
          })}
        </Box>
      ))}
    </Box>
  );
}
