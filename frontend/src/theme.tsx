import { createContext, useContext, useState, useMemo, type ReactNode } from 'react';
import { createTheme, ThemeProvider, CssBaseline } from '@mui/material';

interface Ctx { isDark: boolean; toggle: () => void; }
const ThemeCtx = createContext<Ctx>(null!);

export function AppThemeProvider({ children }: { children: ReactNode }) {
  const [isDark, setIsDark] = useState(false);
  const theme = useMemo(() => createTheme({
    palette: { mode: isDark ? 'dark' : 'light', primary: { main: '#A5D610' }, secondary: { main: '#4DCCFF' } },
    shape: { borderRadius: 12 },
    typography: { fontFamily: 'Inter, system-ui, sans-serif' },
  }), [isDark]);
  return (
    <ThemeCtx.Provider value={{ isDark, toggle: () => setIsDark(d => !d) }}>
      <ThemeProvider theme={theme}><CssBaseline />{children}</ThemeProvider>
    </ThemeCtx.Provider>
  );
}

export const useThemeMode = () => useContext(ThemeCtx);
