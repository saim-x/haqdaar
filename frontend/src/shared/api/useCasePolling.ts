import { useEffect, useRef, useState } from 'react';
import { request } from './client';
import { ApiError } from './errors';
import type { CaseView } from './types';
import { POLL_MAX_MS, POLL_MIN_MS } from '../config';
import { cacheCase, readCachedCase } from '../offline/db';

interface PollState {
  data: CaseView | null;
  error: ApiError | null;
  loading: boolean;
  fromCache: boolean;
  lastCheckedAt: number | null;
}

/**
 * ETag-aware case polling — AC-10.2.
 * Never more than one request per 5 s; backs off to 60 s while the case is in a
 * terminal state or the network is unhappy. A 304 keeps the previous body and
 * costs ~0 bytes, which is the whole point on a dropping 3G connection.
 */
export function useCasePolling(caseId: string | null, citizenId: string | null) {
  const [state, setState] = useState<PollState>({
    data: null,
    error: null,
    loading: true,
    fromCache: false,
    lastCheckedAt: null,
  });

  const etagRef = useRef<string | null>(null);
  const intervalRef = useRef<number>(POLL_MIN_MS);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    if (!caseId) return;

    // Paint the cached copy immediately so the screen is never blank offline.
    void readCachedCase(caseId).then((cached) => {
      if (cancelledRef.current || !cached) return;
      setState((prev) => (prev.data ? prev : { ...prev, data: cached.data, fromCache: true, loading: false }));
      etagRef.current = cached.etag;
    });

    async function tick() {
      if (cancelledRef.current || !caseId) return;
      try {
        const res = await request<CaseView>(`/cases/${caseId}`, { ifNoneMatch: etagRef.current });
        if (cancelledRef.current) return;
        if (res.notModified) {
          setState((prev) => ({ ...prev, loading: false, error: null, lastCheckedAt: Date.now() }));
        } else if (res.data) {
          etagRef.current = res.etag;
          setState({ data: res.data, error: null, loading: false, fromCache: false, lastCheckedAt: Date.now() });
          void cacheCase({ id: caseId, citizenId, data: res.data, etag: res.etag, fetchedAt: Date.now() });
          const terminal = ['APPROVED', 'PAID', 'REJECTED', 'WITHDRAWN', 'CLOSED', 'PAYMENT_FAILED'].includes(res.data.status);
          intervalRef.current = terminal ? POLL_MAX_MS : POLL_MIN_MS;
        }
      } catch (err) {
        if (cancelledRef.current) return;
        const apiErr = err instanceof ApiError ? err : null;
        setState((prev) => ({ ...prev, loading: false, error: apiErr }));
        // Back off on failure instead of hammering a broken connection.
        intervalRef.current = Math.min(intervalRef.current * 2, POLL_MAX_MS);
      } finally {
        if (!cancelledRef.current) {
          timerRef.current = setTimeout(() => void tick(), intervalRef.current);
        }
      }
    }

    void tick();

    return () => {
      cancelledRef.current = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [caseId, citizenId]);

  return state;
}
