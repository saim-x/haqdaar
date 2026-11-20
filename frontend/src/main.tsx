import '@fontsource/noto-sans-arabic/arabic-400.css';
import '@fontsource/noto-sans-arabic/arabic-700.css';
import './index.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { queryClient } from './shared/queryClient';
import { App } from './App';

async function boot() {
  // Dev-only simulated backend (npm run dev:mock). Tree-shaken out of normal builds.
  if (import.meta.env.VITE_MOCK_API === 'true') {
    const { installDevMock } = await import('./shared/devmock');
    installDevMock();
  }

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    </StrictMode>,
  );
}

void boot();
