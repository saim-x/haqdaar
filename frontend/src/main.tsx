import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import { AudioProvider } from './shared/audio/AudioProvider';
import { AuthProvider } from './shared/auth/AuthProvider';
import { I18nProvider } from './shared/i18n/I18nProvider';
import { LiteModeProvider } from './shared/lite/LiteModeProvider';
import { OfflineProvider } from './shared/offline/OfflineProvider';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Offline-first: a cached answer beats a spinner on a 2G connection.
      staleTime: 30_000,
      gcTime: 24 * 60 * 60 * 1000,
      retry: 1,
      refetchOnWindowFocus: false,
      networkMode: 'offlineFirst',
    },
    mutations: { networkMode: 'offlineFirst' },
  },
});

registerSW({ immediate: true });

const root = document.getElementById('root');
if (!root) throw new Error('#root missing from index.html');

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <LiteModeProvider>
          <AudioProvider>
            <AuthProvider>
              <OfflineProvider>
                <BrowserRouter>
                  <App />
                </BrowserRouter>
              </OfflineProvider>
            </AuthProvider>
          </AudioProvider>
        </LiteModeProvider>
      </I18nProvider>
    </QueryClientProvider>
  </StrictMode>,
);
