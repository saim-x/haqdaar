import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './api/client';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Offline-first: show cached data immediately, refetch when possible.
      networkMode: 'offlineFirst',
      staleTime: 15_000,
      gcTime: 24 * 60 * 60 * 1000,
      refetchOnWindowFocus: false,
      retry: (count, err) => {
        if (err instanceof ApiError && !err.network && err.status < 500) return false;
        return count < 2;
      },
    },
    mutations: { networkMode: 'always', retry: false },
  },
});
