import { useState, useCallback } from 'react';
import {
  AppBar, Toolbar, Typography, Container, Paper, Button, Box, Fab,
  CircularProgress, IconButton, Tooltip, TextField, ToggleButtonGroup, ToggleButton,
} from '@mui/material';
import CodeIcon from '@mui/icons-material/Code';
import GitHubIcon from '@mui/icons-material/GitHub';
import TranslateIcon from '@mui/icons-material/Translate';
import LightModeIcon from '@mui/icons-material/LightMode';
import DarkModeIcon from '@mui/icons-material/DarkMode';
import NearMeIcon from '@mui/icons-material/NearMe';
import BlockIcon from '@mui/icons-material/Block';
import LockIcon from '@mui/icons-material/Lock';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import DeleteSweepIcon from '@mui/icons-material/DeleteSweep';
import { ImageUploader, PuzzleEditor, SolutionDisplay, PieceList } from './components';
import { MonitorModal } from './components/MonitorModal';
import { processImage, imageDataFromFile, metadataToPuzzleData } from './core/imageProcessor';
import { solvePuzzle } from './core/solver';
import { COLOR_CSS, ALL_COLORS } from './core/config';
import { debugLogger, profiler } from './monitor';
import { useI18n, useT } from './i18n';
import { useThemeMode } from './theme';
import type { Tool } from './components/PuzzleEditor';
import type { CellCode, ColorCode, ConstraintItem, PuzzleItem, PuzzleMetadata, PuzzleData, Solution } from './types/puzzle';



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

  const handleClearAll = useCallback(() => {
    setGrid(mkGrid(rows, cols));
    setRowC([]);
    setColC([]);
    setPieces([]);
    setSolveState({ status: 'idle' });
  }, [rows, cols]);

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
    <Box className="app-root">
      {/* ── Header ── */}
      <AppBar position="static" elevation={0} sx={{ bgcolor: 'background.paper', borderBottom: 1, borderColor: 'divider' }}>
        <Toolbar sx={{ px: { xs: 2, sm: 3 } }}>
          <Box className="app-logo">
            <svg width="28" height="28" viewBox="0 0 100 100">
              <path d="M25 25 L75 25 L75 45 L45 45 L45 75 L25 75 Z" fill="#A5D610" />
              <path d="M55 55 L75 55 L75 75 L55 75 Z" fill="#4DCCFF" />
            </svg>
          </Box>
          <Box sx={{ flex: 1 }}>
            <Typography variant="h6" fontWeight={700} color="text.primary" lineHeight={1.2}>{t('app.title')}</Typography>
            <Typography variant="body2" color="text.secondary">{t('app.subtitle')}</Typography>
          </Box>
          <Tooltip title={locale === 'zh' ? 'English' : '中文'}>
            <IconButton size="small" onClick={() => setLocale(locale === 'zh' ? 'en' : 'zh')}>
              <TranslateIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title={isDark ? t('theme.light') : t('theme.dark')}>
            <IconButton size="small" onClick={toggleTheme} sx={{ ml: 0.5 }}>
              {isDark ? <LightModeIcon fontSize="small" /> : <DarkModeIcon fontSize="small" />}
            </IconButton>
          </Tooltip>
          <Tooltip title="GitHub">
            <IconButton size="small" component="a" href="https://github.com/Ichigo2315/EndfieldPuzzler" target="_blank" rel="noopener noreferrer" sx={{ ml: 0.5 }}>
              <GitHubIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Toolbar>
      </AppBar>

      {/* ── Content ── */}
      <Container maxWidth="lg" className="app-content">
        <ImageUploader onImageSelect={handleImageSelect} disabled={isProcessing} />

        {isProcessing && (
          <Box display="flex" alignItems="center" gap={2}>
            <CircularProgress size={20} />
            <Typography variant="body2" color="text.secondary">{t('status.processing')}</Typography>
          </Box>
        )}

        {/* ── Toolbar ── */}
        <Paper variant="outlined" className="app-toolbar" sx={{ border: '1px solid', borderColor: 'divider' }}>
          <Box className="app-tool-group" sx={{ border: '1px solid', borderColor: 'divider', bgcolor: 'background.paper' }}>
            <ToggleButtonGroup size="small" value={tool} exclusive onChange={(_, v) => v && setTool(v)} sx={{ border: 'none', '& .MuiToggleButton-root': { border: 'none', borderRadius: 0 } }}>
              <ToggleButton value="select"><Tooltip title={t('editor.tool.select')}><NearMeIcon fontSize="small" /></Tooltip></ToggleButton>
              <ToggleButton value="restore"><Tooltip title={t('editor.tool.restore')}><AutoFixHighIcon fontSize="small" /></Tooltip></ToggleButton>
              <ToggleButton value="blocked"><Tooltip title={t('editor.tool.blocked')}><BlockIcon fontSize="small" /></Tooltip></ToggleButton>
              <ToggleButton value="occupied"><Tooltip title={t('editor.tool.occupied')}><LockIcon fontSize="small" /></Tooltip></ToggleButton>
            </ToggleButtonGroup>

            <Box className="toolbar-inline-divider" sx={{ bgcolor: 'divider' }} />

            <Tooltip title={t('action.clear')}>
              <IconButton onClick={handleClearAll} size="small" sx={{
                color: 'error.main', borderRadius: 0, p: '7px',
                '&:hover': { bgcolor: 'error.lighter' }
              }}>
                <DeleteSweepIcon sx={{ fontSize: 20 }} />
              </IconButton>
            </Tooltip>
          </Box>

          {tool === 'occupied' && (
            <Box display="flex" gap={1}>
              {ALL_COLORS.map(cc => (
                <Box key={cc} onClick={() => setOccColor(cc)}
                  className={`color-swatch-occ${cc === occColor ? ' active' : ''}`}
                  sx={{ bgcolor: COLOR_CSS[cc] }}
                />
              ))}
            </Box>
          )}

          <Box className="toolbar-section-divider" sx={{ bgcolor: 'divider' }} />

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
            sx={{ fontWeight: 700, px: 3, borderRadius: '8px', textTransform: 'none', fontSize: 16 }}
          >
            {t('action.solve')}
          </Button>
        </Paper>

        {/* ── Editor + Pieces (CSS Grid) ── */}
        <Box className="editor-layout">
          <Paper variant="outlined" className="editor-panel" sx={{ bgcolor: 'background.default', border: '1px solid', borderColor: 'divider' }}>
            <PuzzleEditor
              grid={grid} rowC={rowC} colC={colC}
              tool={tool} occColor={occColor}
              onCellClick={handleCellClick}
              onConstraintChange={handleConstraintChange}
            />
          </Paper>
          <Paper variant="outlined" className="pieces-panel" sx={{ border: '1px solid', borderColor: 'divider' }}>
            <PieceList
              pieces={pieces}
              onAdd={item => setPieces(prev => [...prev, item])}
              onDelete={idx => setPieces(prev => prev.filter((_, i) => i !== idx))}
            />
          </Paper>
        </Box>

        {/* ── Solution / Error ── */}
        {solveState.status === 'solved' && (
          <Paper variant="outlined" className="solution-panel" sx={{ bgcolor: 'background.default', border: '1px solid', borderColor: 'divider' }}>
            <SolutionDisplay puzzleData={solveState.puzzleData} metadata={solveState.metadata} solution={solveState.solution} />
          </Paper>
        )}
        {solveState.status === 'error' && (
          <Paper variant="outlined" className="error-panel">
            <Typography variant="h5" color="text.disabled" mb={1}>🚫</Typography>
            <Typography fontWeight={600} color="text.secondary">{solveState.message}</Typography>
            <Typography variant="caption" color="text.disabled">{t('result.noSolutionHint')}</Typography>
          </Paper>
        )}
      </Container>

      {/* ── Footer ── */}
      <Box className="app-footer">
        <Typography variant="caption" color="text.secondary" sx={{ display: 'flex', alignItems: 'center', gap: 0.5, justifyContent: 'center', flexWrap: 'wrap' }}>
          Built with
          <a href="https://vite.dev" target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: 'inherit', textDecoration: 'none' }}>
            <svg width="14" height="14" viewBox="0 0 410 404" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M399.641 59.525L215.643 388.545C211.844 395.338 202.084 395.378 198.228 388.618L10.552 59.525C6.379 52.178 12.114 43.207 20.539 44.474L204.958 73.819C206.139 73.996 207.338 73.993 208.519 73.811L390.034 44.535C398.424 43.238 404.169 52.068 399.641 59.525Z" fill="url(#vite-grad-a)" />
              <path d="M292.965 1.474L156.801 28.264C154.563 28.706 152.906 30.603 152.82 32.884L146.11 199.063C145.991 202.16 148.701 204.614 151.772 204.174L189.151 198.844C192.584 198.355 195.499 201.39 194.867 204.8L186.849 247.858C186.185 251.442 189.371 254.536 192.91 253.792L216.037 248.406C219.581 247.661 222.77 250.763 222.098 254.35L210.282 318.369C209.328 323.517 216.236 326.369 219.061 321.937L220.906 318.973L311.756 139.535C313.479 136.142 310.121 132.337 306.511 133.565L268.167 146.767C264.733 147.949 261.605 144.59 262.874 141.213L292.965 1.474Z" fill="url(#vite-grad-b)" />
              <defs>
                <linearGradient id="vite-grad-a" x1="6.079" y1="32.836" x2="235.189" y2="344.645" gradientUnits="userSpaceOnUse">
                  <stop stopColor="#41D1FF" /><stop offset="1" stopColor="#BD34FE" />
                </linearGradient>
                <linearGradient id="vite-grad-b" x1="194.651" y1="8.818" x2="236.076" y2="292.989" gradientUnits="userSpaceOnUse">
                  <stop stopColor="#FFBD4F" /><stop offset="1" stopColor="#FF9800" />
                </linearGradient>
              </defs>
            </svg>
            Vite
          </a>
          |&nbsp;Powered by
          <a href="https://onnxruntime.ai" target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: 'inherit', textDecoration: 'none' }}>
            <img src="/onnx-icon.svg" alt="ONNX Runtime" width="14" height="14" />
            ONNX Runtime Web
          </a>
        </Typography>
      </Box>

      {/* ── FAB ── */}
      <Fab size="small" onClick={() => setMonitorOpen(true)}
        sx={{
          position: 'fixed', bottom: 16, right: 16,
          bgcolor: isDark ? 'grey.800' : 'background.paper',
          color: isDark ? '#fff' : 'inherit',
          '&:hover': { bgcolor: isDark ? 'grey.700' : 'action.hover' }
        }}>
        <CodeIcon fontSize="small" />
      </Fab>
      <MonitorModal open={monitorOpen} onClose={() => setMonitorOpen(false)} previewUrl={previewUrl} />
    </Box>
  );
}

export default App;
