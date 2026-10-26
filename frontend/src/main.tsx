import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MotionConfig } from 'framer-motion';
import { OfflineProvider } from './features/offline/OfflineProvider';
import { AuthProvider } from './app/providers/AuthProvider';
import { ThemeProvider } from './app/providers/ThemeProvider';
import { Router } from './app/router/Router';
import { uk } from './lib/i18n';
import './styles/tokens.css';
import './styles/global.css';
import './styles/gamification.css';
import './styles/notifications.css';
import './styles/account.css';
import { registerServiceWorker } from './services/service-worker';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000, refetchOnWindowFocus: 'always' } },
});
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <MotionConfig reducedMotion="user">
          <BrowserRouter>
            <AuthProvider>
              <OfflineProvider>
                <a className="skip-link" href="#main-content">
                  {uk.skip}
                </a>
                <Router />
              </OfflineProvider>
            </AuthProvider>
          </BrowserRouter>
        </MotionConfig>
      </ThemeProvider>
    </QueryClientProvider>
  </StrictMode>,
);
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void registerServiceWorker().catch(() => {
      /* Online application remains available when SW is disabled. */
    });
  });
}
