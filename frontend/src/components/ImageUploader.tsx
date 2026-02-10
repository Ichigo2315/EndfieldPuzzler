import { useCallback, useState, useRef, useEffect } from 'react';
import { Box, Typography } from '@mui/material';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import { useT } from '../i18n';

interface Props { onImageSelect: (file: File) => void; disabled?: boolean; }

export function ImageUploader({ onImageSelect, disabled }: Props) {
  const t = useT();
  const [drag, setDrag] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const pick = useCallback((file: File | null | undefined) => {
    if (file?.type.startsWith('image/')) onImageSelect(file);
  }, [onImageSelect]);

  // Listen for paste globally so Ctrl+V works from anywhere on the page
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      if (disabled) return;
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          e.preventDefault();
          pick(item.getAsFile());
          break;
        }
      }
    };
    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, [disabled, pick]);

  return (
    <Box
      onClick={() => !disabled && inputRef.current?.click()}
      onDrop={e => { e.preventDefault(); setDrag(false); if (!disabled) pick(e.dataTransfer.files[0]); }}
      onDragOver={e => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      tabIndex={0}
      sx={{
        border: '2px dashed', borderColor: drag ? 'primary.main' : 'divider',
        borderRadius: 3, p: 2, textAlign: 'center', cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1, bgcolor: drag ? 'action.hover' : 'transparent',
        transition: 'all .2s',
        minHeight: 240, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        '&:hover': { borderColor: 'primary.main', bgcolor: 'action.hover' },
      }}
    >
      <input ref={inputRef} type="file" accept="image/*" hidden onChange={e => pick(e.target.files?.[0])} disabled={disabled} />
      <CloudUploadIcon sx={{ fontSize: 48, color: 'primary.main', mb: 1 }} />
      <Typography variant="subtitle1" fontWeight={600}>{t('upload.title')}</Typography>
      <Typography variant="body2" color="text.secondary">{t('upload.hint')}</Typography>
    </Box>
  );
}
