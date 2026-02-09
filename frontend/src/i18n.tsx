import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import zh from '../locale/zh.json';
import en from '../locale/en.json';

export type Locale = 'zh' | 'en';
const msgs: Record<Locale, Record<string, string>> = { zh, en };
const detect = (): Locale => navigator.language.startsWith('zh') ? 'zh' : 'en';

interface Ctx { locale: Locale; setLocale: (l: Locale) => void; t: (key: string, vars?: Record<string, string | number>) => string; }
const I18nCtx = createContext<Ctx>(null!);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>(detect);
  const t = useCallback((key: string, vars?: Record<string, string | number>) => {
    let s = msgs[locale][key] ?? key;
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
    return s;
  }, [locale]);
  return <I18nCtx.Provider value={{ locale, setLocale, t }}>{children}</I18nCtx.Provider>;
}

export const useI18n = () => useContext(I18nCtx);
export const useT = () => useContext(I18nCtx).t;
