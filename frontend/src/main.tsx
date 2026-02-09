import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nProvider } from './i18n';
import { AppThemeProvider } from './theme';
import App from './App';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <AppThemeProvider>
        <App />
      </AppThemeProvider>
    </I18nProvider>
  </StrictMode>,
);
