import { useState, useEffect } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, IconButton, Tabs, Tab, Box, Typography, Chip, Button,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import DownloadIcon from '@mui/icons-material/Download';
import { debugLogger, type DebugLogEntry } from '../core/monitor/debugLogger';
import { profiler, STAGE_COLORS, type StageRecord } from '../core/monitor/profiler';
import { useT } from '../i18n';

function useLogs() {
  const [logs, setLogs] = useState<DebugLogEntry[]>([]);
  useEffect(() => { setLogs(debugLogger.getLogs()); return debugLogger.subscribe(() => setLogs(debugLogger.getLogs())); }, []);
  return logs;
}
function useProfile() {
  const [records, setRecords] = useState<StageRecord[]>([]);
  const [total, setTotal] = useState(0);
  useEffect(() => { const up = () => { setRecords(profiler.getRecords()); setTotal(profiler.totalMs); }; up(); return profiler.subscribe(up); }, []);
  return { records, total };
}

const LC: Record<string, 'error' | 'warning' | 'default'> = { error: 'error', warning: 'warning', info: 'default' };

function LogTab() {
  const t = useT(); const logs = useLogs();
  return (
    <Box sx={{ maxHeight: 480, overflow: 'auto', p: 1 }}>
      {logs.length === 0
        ? <Typography color="text.secondary" textAlign="center" py={6}>{t('monitor.noLogs')}</Typography>
        : logs.map((l: DebugLogEntry) => (
          <Box key={l.id} sx={{ mb: 1, p: 1.5, borderRadius: 1, bgcolor: l.type === 'error' ? 'error.main' : 'action.hover', color: l.type === 'error' ? 'error.contrastText' : undefined }}>
            <Box display="flex" alignItems="center" gap={1} mb={0.5}>
              <Chip label={l.stage} size="small" color={LC[l.type] ?? 'default'} variant="outlined" />
              <Typography variant="caption" color="text.secondary">{l.timestamp.toLocaleTimeString()}</Typography>
            </Box>
            <Typography variant="body2">{l.message}</Typography>
            {l.data && (
              <Box component="pre" sx={{ mt: 1, p: 1, bgcolor: 'background.default', borderRadius: 1, fontSize: 11, overflow: 'auto', maxHeight: 120, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                {JSON.stringify(l.data)}
              </Box>
            )}
          </Box>
        ))}
    </Box>
  );
}

function ProfileTab() {
  const t = useT(); const { records, total } = useProfile();
  if (!records.length) return <Typography color="text.secondary" textAlign="center" py={6}>{t('monitor.noPerf')}</Typography>;
  return (
    <Box p={2}>
      <Typography variant="subtitle2" gutterBottom>{t('monitor.total', { ms: total.toFixed(0) })}</Typography>
      <Box sx={{ display: 'flex', height: 32, borderRadius: 1, overflow: 'hidden', mb: 3 }}>
        {records.map((r, i) => {
          const pct = total > 0 ? (r.durationMs / total) * 100 : 0;
          return <Box key={i} title={`${t('profiler.' + r.stage)}: ${r.durationMs.toFixed(0)} ms`}
            sx={{ width: `${pct}%`, minWidth: pct > 0 ? 2 : 0, bgcolor: STAGE_COLORS[r.stage], transition: 'width .3s' }} />;
        })}
      </Box>
      <Box display="flex" flexWrap="wrap" gap={1.5}>
        {records.map((r, i) => (
          <Box key={i} display="flex" alignItems="center" gap={0.5}>
            <Box sx={{ width: 12, height: 12, borderRadius: '2px', bgcolor: STAGE_COLORS[r.stage] }} />
            <Typography variant="caption">{t('profiler.' + r.stage)} <b>{r.durationMs.toFixed(0)} ms</b></Typography>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

function ScreenshotTab({ url }: { url?: string | null }) {
  const t = useT();
  if (!url) return <Typography color="text.secondary" textAlign="center" py={6}>{t('monitor.noScreenshot')}</Typography>;
  return <Box p={2}><Box component="img" src={url} alt="screenshot" sx={{ maxWidth: '100%', borderRadius: 1 }} /></Box>;
}

function exportLogs() {
  const payload = JSON.stringify({ exportedAt: new Date().toISOString(), logs: debugLogger.getLogs(), profiling: profiler.getRecords() });
  const blob = new Blob([payload], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url;
  a.download = `puzzle-debug-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  a.click(); URL.revokeObjectURL(url);
}

interface Props { open: boolean; onClose: () => void; previewUrl?: string | null; }

export function MonitorModal({ open, onClose, previewUrl }: Props) {
  const t = useT();
  const [tab, setTab] = useState(0);
  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', pb: 0 }}>
        {t('monitor.title')}
        <IconButton onClick={onClose} size="small"><CloseIcon /></IconButton>
      </DialogTitle>
      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ px: 3 }}>
        <Tab label={t('monitor.logs')} />
        <Tab label={t('monitor.perf')} />
        <Tab label={t('monitor.screenshot')} />
      </Tabs>
      <DialogContent dividers sx={{ p: 0 }}>
        {tab === 0 && <LogTab />}
        {tab === 1 && <ProfileTab />}
        {tab === 2 && <ScreenshotTab url={previewUrl} />}
      </DialogContent>
      <DialogActions>
        <Button size="small" startIcon={<DownloadIcon />} onClick={exportLogs}>{t('monitor.export')}</Button>
        <Button size="small" onClick={() => { debugLogger.clear(); profiler.reset(); }}>{t('monitor.clear')}</Button>
      </DialogActions>
    </Dialog>
  );
}
