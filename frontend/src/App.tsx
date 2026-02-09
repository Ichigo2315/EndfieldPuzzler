import { useState, useCallback } from 'react';
import {
  AppBar, Toolbar, Typography, Container, Paper, Button, Box, Fab, Switch,
  CircularProgress, IconButton, Tooltip, TextField, ToggleButtonGroup, ToggleButton,
} from '@mui/material';
import CodeIcon from '@mui/icons-material/Code';
import TranslateIcon from '@mui/icons-material/Translate';
import LightModeIcon from '@mui/icons-material/LightMode';
import DarkModeIcon from '@mui/icons-material/DarkMode';
import NearMeIcon from '@mui/icons-material/NearMe';
import BlockIcon from '@mui/icons-material/Block';
import LockIcon from '@mui/icons-material/Lock';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import { ImageUploader, PuzzleEditor, SolutionDisplay, PieceList } from './components';
import { MonitorModal } from './components/MonitorModal';
import { processImage, imageDataFromFile, metadataToPuzzleData } from './core/imageProcessor';
import { solvePuzzle } from './core/solver';
import { debugLogger, profiler } from './core/monitor';
import { useI18n, useT } from './i18n';
import { useThemeMode } from './theme';
import type { Tool } from './components/PuzzleEditor';
import type { CellCode, ColorCode, ConstraintItem, PuzzleItem, PuzzleMetadata, PuzzleData, Solution } from './types/puzzle';

const COLOR_CSS: Record<ColorCode, string> = { GN: '#A5D610', BL: '#4DCCFF', CY: '#00BCD4', OG: '#FF9800' };
const ALL_COLORS: ColorCode[] = ['GN', 'BL', 'CY', 'OG'];

const mkGrid = (r: number, c: number): CellCode[][] =>
  Array.from({ length: r }, () => Array<CellCode>(c).fill('EP'));

type SolveState =
  | { status: 'idle' }
  | { status: 'solving' }
  | { status: 'solved'; solution: Solution; metadata: PuzzleMetadata; puzzleData: PuzzleData }
  | { status: 'error'; message: string };

function App() {
  const t = useT();
  const { locale, setLocale } = useI18n();
  const { isDark, toggle: toggleTheme } = useThemeMode();

  // ── Puzzle state ──
  const [grid, setGrid] = useState<CellCode[][]>(mkGrid(5, 5));
  const [rowC, setRowC] = useState<ConstraintItem[]>([]);
  const [colC, setColC] = useState<ConstraintItem[]>([]);
  const [pieces, setPieces] = useState<PuzzleItem[]>([]);

  // ── Tool state ──
  const [tool, setTool] = useState<Tool>('select');
  const [occColor, setOccColor] = useState<ColorCode>('GN');

  // ── Solve state ──
  const [solveState, setSolveState] = useState<SolveState>({ status: 'idle' });
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [monitorOpen, setMonitorOpen] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;

  // ── Size change ──
  const handleSizeChange = useCallback((nr: number, nc: number) => {
    const r = Math.max(1, Math.min(10, nr));
    const c = Math.max(1, Math.min(10, nc));
    setGrid(mkGrid(r, c));
    setRowC([]);
    setColC([]);
    setSolveState({ status: 'idle' });
  }, []);

  // ── Cell click ──
  const handleCellClick = useCallback((r: number, c: number) => {
    setGrid(g => {
      const ng = g.map(row => [...row]);
      switch (tool) {
        case 'restore': ng[r][c] = 'EP'; break;
        case 'blocked': ng[r][c] = ng[r][c] === 'BK' ? 'EP' : 'BK'; break;
        case 'occupied': ng[r][c] = ng[r][c] === occColor ? 'EP' : occColor; break;
      }
      return ng;
    });
  }, [tool, occColor]);

  // ── Constraint change ──
  const handleConstraintChange = useCallback((type: 'row' | 'col', idx: number, items: ConstraintItem[]) => {
    const set = type === 'row' ? setRowC : setColC;
    set(prev => [...prev.filter(c => c.index !== idx), ...items]);
  }, []);

  // ── Solve ──
  const doSolve = useCallback((md: PuzzleMetadata) => {
    const pd = metadataToPuzzleData(md);
    profiler.start('solve');
    const sol = solvePuzzle(pd);
    profiler.end('solve');
    if (sol) {
      debugLogger.info('solve', 'Solution', {
        placements: sol.placements.map(p => `${p.pieceId}@(${p.row},${p.col})r${p.rotationIndex}`),
      });
      setSolveState({ status: 'solved', solution: sol, metadata: md, puzzleData: pd });
    } else {
      setSolveState({ status: 'error', message: t('result.noSolution') });
    }
  }, [t]);

  const handleSolve = useCallback(() => {
    const colorSet = new Set<ColorCode>();
    for (const row of grid) for (const cell of row) if (cell !== 'EP' && cell !== 'BK') colorSet.add(cell as ColorCode);
    for (const c of [...rowC, ...colC]) colorSet.add(c.color);
    for (const p of pieces) colorSet.add(p.color);
    const colors = [...colorSet] as ColorCode[];
    const md: PuzzleMetadata = { num_row: rows, num_col: cols, colors, map: grid, row_constraints: rowC, col_constraints: colC, puzzles: pieces };
    doSolve(md);
  }, [grid, rowC, colC, pieces, rows, cols, doSolve]);

  // ── Image upload ──
  const handleImageSelect = useCallback(async (file: File) => {
    debugLogger.clear(); profiler.reset();
    debugLogger.info('general', `Processing: ${file.name} (${(file.size / 1024).toFixed(0)} KB)`);
    try {
      setPreviewUrl(URL.createObjectURL(file));
      setIsProcessing(true);
      const imageData = await imageDataFromFile(file);
      const md = await processImage(imageData);
      setGrid(md.map.map(r => [...r]));
      setRowC([...md.row_constraints]);
      setColC([...md.col_constraints]);
      setPieces([...md.puzzles]);
      setIsProcessing(false);
      doSolve(md);
    } catch (err) {
      setIsProcessing(false);
      const msg = err instanceof Error ? err.message : t('error.processing');
      debugLogger.error('general', msg);
      setSolveState({ status: 'error', message: msg });
    }
  }, [t, doSolve]);

  return (
    <Box sx={{ minHeight: '100vh' }}>
      {/* ── Header ── */}
      <AppBar position="static" elevation={0} sx={{ bgcolor: 'background.paper', borderBottom: 1, borderColor: 'divider' }}>
        <Toolbar>
          <Box sx={{ width: 36, height: 36, borderRadius: 1, bgcolor: 'primary.main', display: 'flex', alignItems: 'center', justifyContent: 'center', mr: 1.5 }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="#fff">
              <path d="M4 4h8v8H4V4zm2 2v4h4V6H6zm8-2h8v8h-8V4zm2 2v4h4V6h-4zM4 14h8v8H4v-8zm2 2v4h4v-4H6z" />
            </svg>
          </Box>
          <Box sx={{ flex: 1 }}>
            <Typography variant="subtitle1" fontWeight={700} color="text.primary" lineHeight={1.2}>{t('app.title')}</Typography>
            <Typography variant="caption" color="text.secondary">{t('app.subtitle')}</Typography>
          </Box>
          <Tooltip title={locale === 'zh' ? 'English' : '中文'}>
            <IconButton size="small" onClick={() => setLocale(locale === 'zh' ? 'en' : 'zh')}>
              <TranslateIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Switch
            checked={isDark} onChange={toggleTheme} size="small" sx={{ ml: 0.5 }}
            icon={<Box sx={{ width: 20, height: 20, borderRadius: '50%', bgcolor: '#ffd93d', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><LightModeIcon sx={{ fontSize: 12, color: '#f57f17' }} /></Box>}
            checkedIcon={<Box sx={{ width: 20, height: 20, borderRadius: '50%', bgcolor: '#283593', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><DarkModeIcon sx={{ fontSize: 12, color: '#c5cae9' }} /></Box>}
          />
        </Toolbar>
      </AppBar>

      {/* ── Content ── */}
      <Container maxWidth="lg" sx={{ py: 3, display: 'flex', flexDirection: 'column', gap: 3 }}>
        <ImageUploader onImageSelect={handleImageSelect} disabled={isProcessing} />

        {isProcessing && (
          <Box display="flex" alignItems="center" gap={2}>
            <CircularProgress size={20} />
            <Typography variant="body2" color="text.secondary">{t('status.processing')}</Typography>
          </Box>
        )}

        {/* ── Toolbar ── */}
        <Paper variant="outlined" sx={{ p: 1.5, display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
          <ToggleButtonGroup size="small" value={tool} exclusive onChange={(_, v) => v && setTool(v)}>
            <ToggleButton value="select"><Tooltip title={t('editor.tool.select')}><NearMeIcon fontSize="small" /></Tooltip></ToggleButton>
            <ToggleButton value="restore"><Tooltip title={t('editor.tool.restore')}><AutoFixHighIcon fontSize="small" /></Tooltip></ToggleButton>
            <ToggleButton value="blocked"><Tooltip title={t('editor.tool.blocked')}><BlockIcon fontSize="small" /></Tooltip></ToggleButton>
            <ToggleButton value="occupied"><Tooltip title={t('editor.tool.occupied')}><LockIcon fontSize="small" /></Tooltip></ToggleButton>
          </ToggleButtonGroup>

          {tool === 'occupied' && (
            <Box display="flex" gap={0.5}>
              {ALL_COLORS.map(cc => (
                <Box key={cc} onClick={() => setOccColor(cc)} sx={{
                  width: 24, height: 24, borderRadius: '50%', cursor: 'pointer', bgcolor: COLOR_CSS[cc],
                  outline: cc === occColor ? '2.5px solid' : '2px solid transparent',
                  outlineColor: cc === occColor ? 'text.primary' : 'transparent', outlineOffset: 1,
                }} />
              ))}
            </Box>
          )}

          <Box sx={{ width: '1px', height: 28, bgcolor: 'divider', mx: 0.5 }} />

          <TextField
            label={t('editor.rows')} type="number" size="small" variant="outlined"
            value={rows} onChange={e => handleSizeChange(parseInt(e.target.value) || 1, cols)}
            inputProps={{ min: 1, max: 10, style: { width: 36, textAlign: 'center' } }}
          />
          <Typography color="text.secondary">×</Typography>
          <TextField
            label={t('editor.cols')} type="number" size="small" variant="outlined"
            value={cols} onChange={e => handleSizeChange(rows, parseInt(e.target.value) || 1)}
            inputProps={{ min: 1, max: 10, style: { width: 36, textAlign: 'center' } }}
          />

          <Box flex={1} />

          <Button
            variant="contained" size="large"
            startIcon={<PlayArrowIcon />}
            onClick={handleSolve}
            disabled={isProcessing}
            sx={{ fontWeight: 700, px: 3, borderRadius: 2, textTransform: 'none', fontSize: 16 }}
          >
            {t('action.solve')}
          </Button>
        </Paper>

        {/* ── Editor + Pieces (CSS Grid) ── */}
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 260px' }, gap: 3, alignItems: 'start' }}>
          <Paper variant="outlined" sx={{ p: 2, display: 'flex', justifyContent: 'center' }}>
            <PuzzleEditor
              grid={grid} rowC={rowC} colC={colC}
              tool={tool} occColor={occColor}
              onCellClick={handleCellClick}
              onConstraintChange={handleConstraintChange}
            />
          </Paper>
          <Paper variant="outlined" sx={{ p: 2 }}>
            <PieceList
              pieces={pieces}
              onAdd={item => setPieces(prev => [...prev, item])}
              onDelete={idx => setPieces(prev => prev.filter((_, i) => i !== idx))}
            />
          </Paper>
        </Box>

        {/* ── Solution / Error ── */}
        {solveState.status === 'solved' && (
          <Paper variant="outlined" sx={{ p: 2, border: '2px solid', borderColor: 'primary.main' }}>
            <SolutionDisplay puzzleData={solveState.puzzleData} metadata={solveState.metadata} solution={solveState.solution} />
          </Paper>
        )}
        {solveState.status === 'error' && (
          <Paper variant="outlined" sx={{ p: 4, textAlign: 'center' }}>
            <Typography variant="h5" color="text.disabled" mb={1}>🚫</Typography>
            <Typography fontWeight={600} color="text.secondary">{solveState.message}</Typography>
            <Typography variant="caption" color="text.disabled">{t('result.noSolutionHint')}</Typography>
          </Paper>
        )}
      </Container>

      {/* ── FAB ── */}
      <Fab size="small" onClick={() => setMonitorOpen(true)}
        sx={{ position: 'fixed', bottom: 16, right: 16, bgcolor: 'background.paper', '&:hover': { bgcolor: 'action.hover' } }}>
        <CodeIcon fontSize="small" />
      </Fab>
      <MonitorModal open={monitorOpen} onClose={() => setMonitorOpen(false)} previewUrl={previewUrl} />
    </Box>
  );
}

export default App;
