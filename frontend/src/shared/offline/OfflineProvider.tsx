import { createContext, useContext, useEffect, useMemo, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  discardRow,
  drain,
  getOutboxState,
  installOutboxListeners,
  retryRow,
  setOutboxSyncListener,
  subscribeOutbox,
  type OutboxState,
} from './outbox';

interface OfflineContextValue extends OutboxState {
  retryNow(): void;
  retryOne(id: string): void;
  discardOne(id: string): void;
}

const OfflineContext = createContext<OfflineContextValue | null>(null);

export function OfflineProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const snapshot = useSyncExternalStore(subscribeOutbox, getOutboxState, getOutboxState);

  useEffect(() => {
    // A successful drain means the server now has newer truth than our cache.
    setOutboxSyncListener(() => {
      void queryClient.invalidateQueries();
    });
    const teardown = installOutboxListeners();
    return () => {
      setOutboxSyncListener(null);
      teardown();
    };
  }, [queryClient]);

  const value = useMemo<OfflineContextValue>(
    () => ({
      ...snapshot,
      retryNow: () => void drain(),
      retryOne: (id: string) => void retryRow(id),
      discardOne: (id: string) => void discardRow(id),
    }),
    [snapshot],
  );

  return <OfflineContext.Provider value={value}>{children}</OfflineContext.Provider>;
}

export function useOffline(): OfflineContextValue {
  const ctx = useContext(OfflineContext);
  if (!ctx) throw new Error('useOffline must be used inside <OfflineProvider>');
  return ctx;
}
